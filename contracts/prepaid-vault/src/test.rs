extern crate std;

use agent_registry::{AgentRegistry, AgentRegistryClient, RateCardInput, UsageMeterRates};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, Vec};

use crate::{
    contract::{PrepaidVault, PrepaidVaultClient},
    utils,
    PolicyInput, RunLifecycle, UsageBreakdown,
};

fn setup_clients<'a>(
    e: &'a Env,
) -> (
    AgentRegistryClient<'a>,
    PrepaidVaultClient<'a>,
    Address,
    Address,
) {
    let registry_addr = e.register(AgentRegistry, ());
    let vault_addr = e.register(PrepaidVault, ());
    let registry_client = AgentRegistryClient::new(e, &registry_addr);
    let vault_client = PrepaidVaultClient::new(e, &vault_addr);
    (registry_client, vault_client, registry_addr, vault_addr)
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn sample_rates() -> UsageMeterRates {
    UsageMeterRates {
        llm_in: 10_000,
        llm_out: 20_000,
        http_calls: 10_000_000,
        runtime_ms: 1,
    }
}

fn default_policy() -> PolicyInput {
    PolicyInput {
        per_run_cap: 50_000_000,
        daily_cap: 100_000_000,
        paused: false,
    }
}

fn setup_agent(
    e: &Env,
    registry: &AgentRegistryClient<'_>,
    developer: &Address,
    runner: &Address,
) -> u32 {
    let mut runners = Vec::new(e);
    runners.push_back(runner.clone());
    let rate = RateCardInput {
        rates: sample_rates(),
        manifest_hash: hash(e, 1),
    };
    registry.register_agent(developer, &None, &runners, &rate)
}

#[test]
fn finalize_refunds_unused_amount() {
    let e = Env::default();
    e.mock_all_auths();
    let (registry, vault, registry_addr, _) = setup_clients(&e);
    let developer = Address::generate(&e);
    let runner = Address::generate(&e);
    let user = Address::generate(&e);

    vault.init(&registry_addr);
    let agent_id = setup_agent(&e, &registry, &developer, &runner);

    let deposit_amount: i128 = 20_000_000;
    vault.deposit(&user, &deposit_amount);
    vault.set_policy(&user, &default_policy());

    let budgets = UsageBreakdown {
        llm_in: 100,
        llm_out: 50,
        http_calls: 1,
        runtime_ms: 1000,
    };

    let rate_version = 1u32;
    let run_id = vault.open_run(&user, &agent_id, &rate_version, &budgets);

    let usage = UsageBreakdown {
        llm_in: 80,
        llm_out: 40,
        http_calls: 1,
        runtime_ms: 500,
    };

    let expected_max = utils::compute_charge(&sample_rates(), &budgets).unwrap();
    let expected_actual = utils::compute_charge(&sample_rates(), &usage).unwrap();
    let expected_refund = expected_max - expected_actual;

    let receipt =
        vault.finalize_run(&run_id, &runner, &rate_version, &usage, &hash(&e, 9));

    assert_eq!(receipt.actual_charge, expected_actual);
    assert_eq!(receipt.refund, expected_refund);
    assert_eq!(vault.balance_of(&user), deposit_amount - expected_actual);
    assert_eq!(vault.developer_balance(&developer), expected_actual);

    let run = vault.get_run(&run_id);
    match run.lifecycle {
        RunLifecycle::Finalized(settlement) => {
            assert_eq!(settlement.actual_charge, expected_actual);
            assert_eq!(settlement.refund, expected_refund);
        }
        _ => panic!("run should be finalized"),
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn usage_over_budget_panics() {
    let e = Env::default();
    e.mock_all_auths();
    let (registry, vault, registry_addr, _) = setup_clients(&e);
    let developer = Address::generate(&e);
    let runner = Address::generate(&e);
    let user = Address::generate(&e);

    vault.init(&registry_addr);
    let agent_id = setup_agent(&e, &registry, &developer, &runner);

    vault.deposit(&user, &20_000_000);
    vault.set_policy(&user, &default_policy());

    let budgets = UsageBreakdown {
        llm_in: 100,
        llm_out: 50,
        http_calls: 1,
        runtime_ms: 1000,
    };
    let run_id = vault.open_run(&user, &agent_id, &1u32, &budgets);

    let usage = UsageBreakdown {
        llm_in: 120,
        llm_out: 40,
        http_calls: 1,
        runtime_ms: 400,
    };

    vault.finalize_run(&run_id, &runner, &1u32, &usage, &hash(&e, 2));
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn mismatched_rate_version_rejected() {
    let e = Env::default();
    e.mock_all_auths();
    let (registry, vault, registry_addr, _) = setup_clients(&e);
    let developer = Address::generate(&e);
    let runner = Address::generate(&e);
    let user = Address::generate(&e);

    vault.init(&registry_addr);
    let agent_id = setup_agent(&e, &registry, &developer, &runner);
    vault.deposit(&user, &20_000_000);
    vault.set_policy(&user, &default_policy());

    let budgets = UsageBreakdown {
        llm_in: 100,
        llm_out: 50,
        http_calls: 1,
        runtime_ms: 1000,
    };
    let run_id = vault.open_run(&user, &agent_id, &1u32, &budgets);

    // publish new rate card version
    let new_rate = RateCardInput {
        rates: UsageMeterRates {
            llm_in: 12_000,
            ..sample_rates()
        },
        manifest_hash: hash(&e, 3),
    };
    registry.publish_rate_card(&agent_id, &new_rate);

    let usage = UsageBreakdown {
        llm_in: 50,
        llm_out: 20,
        http_calls: 1,
        runtime_ms: 200,
    };

    vault.finalize_run(&run_id, &runner, &2u32, &usage, &hash(&e, 4));
}

#[test]
fn cancel_run_refunds_full_amount() {
    let e = Env::default();
    e.mock_all_auths();
    let (registry, vault, registry_addr, _) = setup_clients(&e);
    let developer = Address::generate(&e);
    let runner = Address::generate(&e);
    let user = Address::generate(&e);

    vault.init(&registry_addr);
    let agent_id = setup_agent(&e, &registry, &developer, &runner);
    let deposit_amount = 15_000_000;
    vault.deposit(&user, &deposit_amount);
    vault.set_policy(&user, &default_policy());

    let budgets = UsageBreakdown {
        llm_in: 50,
        llm_out: 20,
        http_calls: 1,
        runtime_ms: 200,
    };

    let rate_version = 1u32;
    let run_id = vault.open_run(&user, &agent_id, &rate_version, &budgets);
    // Cancel should refund entire escrowed amount.
    vault.cancel_run(&user, &run_id);
    assert_eq!(vault.balance_of(&user), deposit_amount);
    assert_eq!(vault.developer_balance(&developer), 0);
    let run = vault.get_run(&run_id);
    match run.lifecycle {
        RunLifecycle::Cancelled => {}
        _ => panic!("run expected to be cancelled"),
    }
}
