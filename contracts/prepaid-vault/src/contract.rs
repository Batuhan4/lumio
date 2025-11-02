use agent_registry::AgentRegistryClient;
use soroban_sdk::{
    contract, contractimpl, panic_with_error, symbol_short, Address, BytesN, Env, Vec,
};

use crate::{
    storage::{DataKey, RunRecord},
    types::{
        PolicyInput, RunFinalizedLog, RunLifecycle, RunOpenedLog, RunReceipt, RunSettlement,
        RunnerGrant, RunnerGrantLog, RunnerRevokeLog, UsageBreakdown, UserPolicy, VaultError,
    },
    utils::{compute_charge, current_day, validate_non_negative_usage},
};

#[contract]
pub struct PrepaidVault;

#[contractimpl]
impl PrepaidVault {
    pub fn init(e: Env, registry: Address) {
        if e.storage().instance().has(&DataKey::AgentRegistry) {
            panic_with_error!(&e, VaultError::AlreadyInitialized);
        }
        e.storage()
            .instance()
            .set(&DataKey::AgentRegistry, &registry);
        e.storage().instance().set(&DataKey::NextRunId, &1u64);
    }

    pub fn deposit(e: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 {
            panic_with_error!(&e, VaultError::InvalidAmount);
        }
        let balance = read_balance(&e, &user);
        let new_balance = balance.checked_add(amount).unwrap();
        write_balance(&e, &user, new_balance);
    }

    pub fn withdraw(e: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 {
            panic_with_error!(&e, VaultError::InvalidAmount);
        }
        let balance = read_balance(&e, &user);
        if balance < amount {
            panic_with_error!(&e, VaultError::InsufficientBalance);
        }
        write_balance(&e, &user, balance - amount);
    }

    pub fn set_policy(e: Env, user: Address, policy: PolicyInput) {
        user.require_auth();
        if policy.per_run_cap < 0 || policy.daily_cap < 0 {
            panic_with_error!(&e, VaultError::InvalidAmount);
        }
        let mut stored = read_policy(&e, &user);
        stored.per_run_cap = policy.per_run_cap;
        stored.daily_cap = policy.daily_cap;
        stored.paused = policy.paused;
        write_policy(&e, &user, &stored);
    }

    pub fn grant_runner(
        e: Env,
        user: Address,
        runner: Address,
        agent_id: u32,
        expires_at: Option<u64>,
    ) {
        user.require_auth();
        if runner == user {
            panic_with_error!(&e, VaultError::InvalidAmount);
        }

        let registry_addr = require_registry(&e);
        let registry = AgentRegistryClient::new(&e, &registry_addr);
        if !registry.is_runner(&agent_id, &runner) {
            panic_with_error!(&e, VaultError::UnauthorizedRunner);
        }

        let grants = read_runner_grants(&e, &user);
        let mut grants = prune_expired_grants(&e, grants);
        for grant in grants.iter() {
            if grant.runner == runner && grant.agent_id == agent_id {
                panic_with_error!(&e, VaultError::RunnerGrantExists);
            }
        }

        let grant = RunnerGrant {
            runner: runner.clone(),
            agent_id,
            issued_at: e.ledger().timestamp(),
            expires_at,
        };

        grants.push_back(grant.clone());
        write_runner_grants(&e, &user, &grants);

        e.events().publish(
            (symbol_short!("runner"), symbol_short!("granted")),
            RunnerGrantLog {
                user,
                runner,
                agent_id,
                issued_at: grant.issued_at,
                expires_at: grant.expires_at,
            },
        );
    }

    pub fn revoke_runner(e: Env, user: Address, runner: Address, agent_id: u32) {
        user.require_auth();

        let grants = read_runner_grants(&e, &user);
        let grants = prune_expired_grants(&e, grants);
        let (filtered, removed) = remove_runner_grant(&e, grants, &runner, agent_id);
        if !removed {
            panic_with_error!(&e, VaultError::RunnerGrantNotFound);
        }
        write_runner_grants(&e, &user, &filtered);

        e.events().publish(
            (symbol_short!("runner"), symbol_short!("revoked")),
            RunnerRevokeLog {
                user,
                runner,
                agent_id,
                revoked_at: e.ledger().timestamp(),
            },
        );
    }

    pub fn list_runner_grants(e: Env, user: Address) -> Vec<RunnerGrant> {
        let grants = read_runner_grants(&e, &user);
        let grants = prune_expired_grants(&e, grants);
        write_runner_grants(&e, &user, &grants);
        grants
    }

    pub fn is_runner_authorized(e: Env, user: Address, runner: Address, agent_id: u32) -> bool {
        ensure_runner_authorized(&e, &user, &runner, agent_id)
    }

    pub fn open_run(
        e: Env,
        user: Address,
        caller: Address,
        agent_id: u32,
        rate_version: u32,
        budgets: UsageBreakdown,
    ) -> u64 {
        caller.require_auth();
        if caller != user {
            if !ensure_runner_authorized(&e, &user, &caller, agent_id) {
                panic_with_error!(&e, VaultError::UnauthorizedRunner);
            }
        }

        if !validate_non_negative_usage(&budgets) {
            panic_with_error!(&e, VaultError::InvalidAmount);
        }

        let registry_addr = require_registry(&e);
        let registry = AgentRegistryClient::new(&e, &registry_addr);

        let rate_card = registry.get_rate_card(&agent_id, &rate_version);
        let max_charge = compute_charge(&rate_card.rates, &budgets)
            .unwrap_or_else(|| panic_with_error!(&e, VaultError::InvalidAmount));

        let mut policy = read_policy(&e, &user);
        let today = current_day(&e);
        policy.ensure_day(today);

        if policy.paused {
            panic_with_error!(&e, VaultError::PolicyPaused);
        }

        if policy.per_run_cap > 0 && max_charge > policy.per_run_cap {
            panic_with_error!(&e, VaultError::PerRunCapExceeded);
        }

        if policy.daily_cap > 0 {
            let new_reserved = policy
                .reserved_today
                .checked_add(max_charge)
                .unwrap_or_else(|| panic_with_error!(&e, VaultError::DailyCapExceeded));
            if new_reserved > policy.daily_cap {
                panic_with_error!(&e, VaultError::DailyCapExceeded);
            }
            policy.reserved_today = new_reserved;
        }

        write_policy(&e, &user, &policy);

        let balance = read_balance(&e, &user);
        if balance < max_charge {
            panic_with_error!(&e, VaultError::InsufficientBalance);
        }
        write_balance(&e, &user, balance - max_charge);

        let run_id = next_run_id(&e);
        let record = RunRecord {
            user: user.clone(),
            opened_by: caller.clone(),
            agent_id,
            rate_version,
            budgets,
            max_charge,
            escrowed: max_charge,
            opened_at: e.ledger().timestamp(),
            lifecycle: RunLifecycle::Open,
        };

        e.storage().instance().set(&DataKey::Run(run_id), &record);

        e.events().publish(
            (symbol_short!("run"), symbol_short!("opened")),
            RunOpenedLog {
                run_id,
                user,
                opened_by: caller,
                agent_id,
                rate_version,
                max_charge,
                budgets: record.budgets.clone(),
                opened_at: record.opened_at,
            },
        );

        run_id
    }

    pub fn finalize_run(
        e: Env,
        run_id: u64,
        runner: Address,
        rate_version: u32,
        usage: UsageBreakdown,
        output_hash: BytesN<32>,
    ) -> RunReceipt {
        runner.require_auth();

        if !validate_non_negative_usage(&usage) {
            panic_with_error!(&e, VaultError::InvalidAmount);
        }

        let mut record = read_run_or_panic(&e, run_id);
        match record.lifecycle {
            RunLifecycle::Open => {}
            _ => panic_with_error!(&e, VaultError::RunNotOpen),
        }

        if rate_version != record.rate_version {
            panic_with_error!(&e, VaultError::InvalidRateVersion);
        }

        if usage.llm_in > record.budgets.llm_in
            || usage.llm_out > record.budgets.llm_out
            || usage.http_calls > record.budgets.http_calls
            || usage.runtime_ms > record.budgets.runtime_ms
        {
            panic_with_error!(&e, VaultError::UsageExceedsBudget);
        }

        let registry_addr = require_registry(&e);
        let registry = AgentRegistryClient::new(&e, &registry_addr);

        if !registry.is_runner(&record.agent_id, &runner) {
            panic_with_error!(&e, VaultError::UnauthorizedRunner);
        }

        let rate_card = registry.get_rate_card(&record.agent_id, &record.rate_version);
        let developer = registry.developer_of(&record.agent_id);

        if !ensure_runner_authorized(&e, &record.user, &runner, record.agent_id) {
            panic_with_error!(&e, VaultError::UnauthorizedRunner);
        }

        let actual_charge = compute_charge(&rate_card.rates, &usage)
            .unwrap_or_else(|| panic_with_error!(&e, VaultError::InvalidAmount));

        if actual_charge > record.max_charge {
            panic_with_error!(&e, VaultError::UsageExceedsBudget);
        }

        let refund = record.max_charge - actual_charge;

        // credit developer
        let dev_balance = read_developer_balance(&e, &developer);
        let new_dev_balance = dev_balance
            .checked_add(actual_charge)
            .unwrap_or_else(|| panic_with_error!(&e, VaultError::InvalidAmount));
        write_developer_balance(&e, &developer, new_dev_balance);

        // refund user
        let user_balance = read_balance(&e, &record.user);
        let new_user_balance = user_balance
            .checked_add(refund)
            .unwrap_or_else(|| panic_with_error!(&e, VaultError::InvalidAmount));
        write_balance(&e, &record.user, new_user_balance);

        // release reservation
        release_reserved(&e, &record.user, record.max_charge);

        record.escrowed = 0;
        let output_hash_clone = output_hash.clone();
        record.lifecycle = RunLifecycle::Finalized(RunSettlement {
            usage: usage.clone(),
            actual_charge,
            refund,
            output_hash,
        });

        e.storage().instance().set(&DataKey::Run(run_id), &record);

        e.events().publish(
            (symbol_short!("run"), symbol_short!("finalized")),
            RunFinalizedLog {
                run_id,
                runner,
                actual_charge,
                refund,
                usage: usage.clone(),
                output_hash: output_hash_clone,
                finalized_at: e.ledger().timestamp(),
            },
        );

        RunReceipt {
            run_id,
            actual_charge,
            refund,
            developer,
        }
    }

    pub fn cancel_run(e: Env, user: Address, run_id: u64) {
        user.require_auth();
        let mut record = read_run_or_panic(&e, run_id);
        if record.user != user {
            panic_with_error!(&e, VaultError::Unauthorized);
        }
        match record.lifecycle {
            RunLifecycle::Open => {}
            _ => panic_with_error!(&e, VaultError::RunNotOpen),
        }

        let user_balance = read_balance(&e, &user);
        let new_balance = user_balance
            .checked_add(record.escrowed)
            .unwrap_or_else(|| panic_with_error!(&e, VaultError::InvalidAmount));
        write_balance(&e, &user, new_balance);

        release_reserved(&e, &user, record.max_charge);

        record.escrowed = 0;
        record.lifecycle = RunLifecycle::Cancelled;

        e.storage().instance().set(&DataKey::Run(run_id), &record);
    }

    pub fn balance_of(e: Env, user: Address) -> i128 {
        read_balance(&e, &user)
    }

    pub fn developer_balance(e: Env, developer: Address) -> i128 {
        read_developer_balance(&e, &developer)
    }

    pub fn claim_developer(e: Env, developer: Address, amount: i128) {
        developer.require_auth();
        if amount <= 0 {
            panic_with_error!(&e, VaultError::InvalidAmount);
        }
        let balance = read_developer_balance(&e, &developer);
        if balance < amount {
            panic_with_error!(&e, VaultError::InsufficientBalance);
        }
        write_developer_balance(&e, &developer, balance - amount);
    }

    pub fn get_run(e: Env, run_id: u64) -> RunRecord {
        read_run_or_panic(&e, run_id)
    }
}

fn ensure_runner_authorized(e: &Env, user: &Address, runner: &Address, agent_id: u32) -> bool {
    let grants = read_runner_grants(e, user);
    let grants = prune_expired_grants(e, grants);
    let mut authorized = false;

    for grant in grants.iter() {
        if grant.runner == runner.clone() && grant.agent_id == agent_id {
            authorized = true;
            break;
        }
    }

    if authorized {
        let registry_addr = require_registry(e);
        let registry = AgentRegistryClient::new(e, &registry_addr);
        if !registry.is_runner(&agent_id, runner) {
            let (filtered, _) = remove_runner_grant(e, grants, runner, agent_id);
            write_runner_grants(e, user, &filtered);
            return false;
        }
        write_runner_grants(e, user, &grants);
        true
    } else {
        write_runner_grants(e, user, &grants);
        false
    }
}

fn require_registry(e: &Env) -> Address {
    match e
        .storage()
        .instance()
        .get::<_, Address>(&DataKey::AgentRegistry)
    {
        Some(addr) => addr,
        None => panic_with_error!(e, VaultError::NotInitialized),
    }
}

fn read_balance(e: &Env, user: &Address) -> i128 {
    e.storage()
        .instance()
        .get::<_, i128>(&DataKey::UserBalance(user.clone()))
        .unwrap_or(0)
}

fn write_balance(e: &Env, user: &Address, amount: i128) {
    e.storage()
        .instance()
        .set(&DataKey::UserBalance(user.clone()), &amount);
}

fn read_developer_balance(e: &Env, developer: &Address) -> i128 {
    e.storage()
        .instance()
        .get::<_, i128>(&DataKey::DeveloperBalance(developer.clone()))
        .unwrap_or(0)
}

fn write_developer_balance(e: &Env, developer: &Address, amount: i128) {
    e.storage()
        .instance()
        .set(&DataKey::DeveloperBalance(developer.clone()), &amount);
}

fn read_policy(e: &Env, user: &Address) -> UserPolicy {
    e.storage()
        .instance()
        .get::<_, UserPolicy>(&DataKey::UserPolicy(user.clone()))
        .unwrap_or_default()
}

fn write_policy(e: &Env, user: &Address, policy: &UserPolicy) {
    e.storage()
        .instance()
        .set(&DataKey::UserPolicy(user.clone()), policy);
}

fn read_runner_grants(e: &Env, user: &Address) -> Vec<RunnerGrant> {
    e.storage()
        .instance()
        .get::<_, Vec<RunnerGrant>>(&DataKey::RunnerGrants(user.clone()))
        .unwrap_or_else(|| Vec::new(e))
}

fn write_runner_grants(e: &Env, user: &Address, grants: &Vec<RunnerGrant>) {
    if grants.len() == 0 {
        e.storage()
            .instance()
            .remove(&DataKey::RunnerGrants(user.clone()));
    } else {
        e.storage()
            .instance()
            .set(&DataKey::RunnerGrants(user.clone()), grants);
    }
}

fn prune_expired_grants(e: &Env, grants: Vec<RunnerGrant>) -> Vec<RunnerGrant> {
    if grants.len() == 0 {
        return grants;
    }
    let now = e.ledger().timestamp();
    let mut filtered = Vec::new(e);
    for grant in grants.iter() {
        match grant.expires_at {
            Some(expiry) if expiry <= now => {}
            _ => filtered.push_back(grant),
        }
    }
    filtered
}

fn remove_runner_grant(
    e: &Env,
    grants: Vec<RunnerGrant>,
    runner: &Address,
    agent_id: u32,
) -> (Vec<RunnerGrant>, bool) {
    if grants.len() == 0 {
        return (grants, false);
    }
    let mut filtered = Vec::new(e);
    let mut removed = false;
    for grant in grants.iter() {
        if grant.runner == runner.clone() && grant.agent_id == agent_id {
            removed = true;
            continue;
        }
        filtered.push_back(grant);
    }
    (filtered, removed)
}

fn release_reserved(e: &Env, user: &Address, amount: i128) {
    let mut policy = read_policy(e, user);
    let today = current_day(e);
    policy.ensure_day(today);
    if policy.reserved_today >= amount {
        policy.reserved_today -= amount;
    } else {
        policy.reserved_today = 0;
    }
    write_policy(e, user, &policy);
}

fn next_run_id(e: &Env) -> u64 {
    let current = e
        .storage()
        .instance()
        .get::<_, u64>(&DataKey::NextRunId)
        .unwrap_or(1);
    let next = current + 1;
    e.storage().instance().set(&DataKey::NextRunId, &next);
    current
}

fn read_run_or_panic(e: &Env, run_id: u64) -> RunRecord {
    match e
        .storage()
        .instance()
        .get::<_, RunRecord>(&DataKey::Run(run_id))
    {
        Some(record) => record,
        None => panic_with_error!(e, VaultError::RunNotFound),
    }
}
