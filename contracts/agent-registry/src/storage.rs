use soroban_sdk::{contracttype, Address, String, Vec};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    NextAgentId,
    Agent(u32),
    RateCard(u32, u32),
}

#[derive(Clone)]
#[contracttype]
pub struct AgentRecord {
    pub developer: Address,
    pub metadata_uri: Option<String>,
    pub runners: Vec<Address>,
    pub latest_rate_version: u32,
}
