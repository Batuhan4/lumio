use soroban_sdk::{contracttype, Address};

use crate::types::{RunLifecycle, UsageBreakdown};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    AgentRegistry,
    UserBalance(Address),
    DeveloperBalance(Address),
    UserPolicy(Address),
    Run(u64),
    NextRunId,
    RunnerGrants(Address),
}

#[derive(Clone)]
#[contracttype]
pub struct RunRecord {
    pub user: Address,
    pub opened_by: Address,
    pub agent_id: u32,
    pub rate_version: u32,
    pub budgets: UsageBreakdown,
    pub max_charge: i128,
    pub escrowed: i128,
    pub opened_at: u64,
    pub lifecycle: RunLifecycle,
}
