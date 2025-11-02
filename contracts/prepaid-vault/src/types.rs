use agent_registry::UsageMeterRates;
use soroban_sdk::{contracterror, contracttype, Address, BytesN};

#[derive(Clone)]
#[contracttype]
pub struct UsageBreakdown {
    pub llm_in: i128,
    pub llm_out: i128,
    pub http_calls: i128,
    pub runtime_ms: i128,
}

impl From<UsageMeterRates> for UsageBreakdown {
    fn from(value: UsageMeterRates) -> Self {
        Self {
            llm_in: value.llm_in,
            llm_out: value.llm_out,
            http_calls: value.http_calls,
            runtime_ms: value.runtime_ms,
        }
    }
}

impl From<UsageBreakdown> for UsageMeterRates {
    fn from(value: UsageBreakdown) -> Self {
        UsageMeterRates {
            llm_in: value.llm_in,
            llm_out: value.llm_out,
            http_calls: value.http_calls,
            runtime_ms: value.runtime_ms,
        }
    }
}

impl UsageBreakdown {
    pub fn to_usage_meter_rates(&self) -> UsageMeterRates {
        UsageMeterRates::from(self.clone())
    }
}

#[derive(Clone)]
#[contracttype]
pub struct UserPolicy {
    pub per_run_cap: i128,
    pub daily_cap: i128,
    pub paused: bool,
    pub reserved_today: i128,
    pub reserved_day: u64,
}

impl Default for UserPolicy {
    fn default() -> Self {
        Self {
            per_run_cap: 0,
            daily_cap: 0,
            paused: false,
            reserved_today: 0,
            reserved_day: 0,
        }
    }
}

impl UserPolicy {
    pub fn ensure_day(&mut self, current_day: u64) {
        if self.reserved_day != current_day {
            self.reserved_day = current_day;
            self.reserved_today = 0;
        }
    }
}

#[derive(Clone)]
#[contracttype]
pub struct RunSettlement {
    pub usage: UsageBreakdown,
    pub actual_charge: i128,
    pub refund: i128,
    pub output_hash: BytesN<32>,
}

#[derive(Clone)]
#[contracttype]
pub struct RunnerGrant {
    pub runner: Address,
    pub agent_id: u32,
    pub issued_at: u64,
    pub expires_at: Option<u64>,
}

#[derive(Clone)]
#[contracttype]
pub struct RunnerGrantLog {
    pub user: Address,
    pub runner: Address,
    pub agent_id: u32,
    pub issued_at: u64,
    pub expires_at: Option<u64>,
}

#[derive(Clone)]
#[contracttype]
pub struct RunnerRevokeLog {
    pub user: Address,
    pub runner: Address,
    pub agent_id: u32,
    pub revoked_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct RunOpenedLog {
    pub run_id: u64,
    pub user: Address,
    pub opened_by: Address,
    pub agent_id: u32,
    pub rate_version: u32,
    pub max_charge: i128,
    pub budgets: UsageBreakdown,
    pub opened_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct RunFinalizedLog {
    pub run_id: u64,
    pub runner: Address,
    pub actual_charge: i128,
    pub refund: i128,
    pub usage: UsageBreakdown,
    pub output_hash: BytesN<32>,
    pub finalized_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub enum RunLifecycle {
    Open,
    Finalized(RunSettlement),
    Cancelled,
}

#[derive(Clone)]
#[contracttype]
pub struct RunReceipt {
    pub run_id: u64,
    pub actual_charge: i128,
    pub refund: i128,
    pub developer: Address,
}

#[derive(Clone)]
#[contracttype]
pub struct PolicyInput {
    pub per_run_cap: i128,
    pub daily_cap: i128,
    pub paused: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracterror]
#[repr(u32)]
pub enum VaultError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InsufficientBalance = 5,
    PolicyPaused = 6,
    PerRunCapExceeded = 7,
    DailyCapExceeded = 8,
    AgentRegistryNotSet = 9,
    AgentNotFound = 10,
    RunNotFound = 11,
    RunNotOpen = 12,
    UsageExceedsBudget = 13,
    InvalidRateVersion = 14,
    UnauthorizedRunner = 15,
    RunnerGrantExists = 16,
    RunnerGrantNotFound = 17,
}
