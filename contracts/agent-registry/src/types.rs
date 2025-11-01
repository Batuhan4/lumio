use soroban_sdk::{contracttype, Address, BytesN, String, Vec};

#[derive(Clone)]
#[contracttype]
pub struct UsageMeterRates {
    pub llm_in: i128,
    pub llm_out: i128,
    pub http_calls: i128,
    pub runtime_ms: i128,
}

impl UsageMeterRates {
    pub fn validate_non_negative(&self) -> bool {
        self.llm_in >= 0 && self.llm_out >= 0 && self.http_calls >= 0 && self.runtime_ms >= 0
    }
}

#[derive(Clone)]
#[contracttype]
pub struct RateCard {
    pub rates: UsageMeterRates,
    pub manifest_hash: BytesN<32>,
}

#[derive(Clone)]
#[contracttype]
pub struct RateCardInput {
    pub rates: UsageMeterRates,
    pub manifest_hash: BytesN<32>,
}

impl From<RateCardInput> for RateCard {
    fn from(value: RateCardInput) -> Self {
        RateCard {
            rates: value.rates,
            manifest_hash: value.manifest_hash,
        }
    }
}

#[derive(Clone)]
#[contracttype]
pub struct AgentDetails {
    pub agent_id: u32,
    pub developer: Address,
    pub metadata_uri: Option<String>,
    pub runners: Vec<Address>,
    pub latest_rate_version: u32,
}
