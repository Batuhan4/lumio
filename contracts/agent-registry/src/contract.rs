use soroban_sdk::{
    contract, contracterror, contractimpl, panic_with_error, Address, Env, String, Vec,
};

use crate::{
    storage::{AgentRecord, DataKey},
    types::{AgentDetails, RateCard, RateCardInput},
};

#[contract]
pub struct AgentRegistry;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracterror]
#[repr(u32)]
pub enum AgentRegistryError {
    AlreadyInitialized = 1,
    AgentNotFound = 2,
    Unauthorized = 3,
    InvalidRunnerList = 4,
    InvalidRates = 5,
    RunnerNotFound = 6,
}

#[contractimpl]
impl AgentRegistry {
    pub fn init(e: Env) {
        if e.storage().instance().has(&DataKey::NextAgentId) {
            panic_with_error!(&e, AgentRegistryError::AlreadyInitialized);
        }
        e.storage().instance().set(&DataKey::NextAgentId, &1u32);
    }

    pub fn register_agent(
        e: Env,
        developer: Address,
        metadata_uri: Option<String>,
        runners: Vec<Address>,
        initial_rate_card: RateCardInput,
    ) -> u32 {
        developer.require_auth();
        if runners.len() == 0 {
            panic_with_error!(&e, AgentRegistryError::InvalidRunnerList);
        }
        if !initial_rate_card.rates.validate_non_negative() {
            panic_with_error!(&e, AgentRegistryError::InvalidRates);
        }

        let mut normalized_runners = Vec::new(&e);
        for runner in runners.iter() {
            if !contains_address(&normalized_runners, &runner) {
                normalized_runners.push_back(runner);
            }
        }

        if normalized_runners.len() == 0 {
            panic_with_error!(&e, AgentRegistryError::InvalidRunnerList);
        }

        let agent_id = next_agent_id_and_increment(&e);

        let record = AgentRecord {
            developer: developer.clone(),
            metadata_uri,
            runners: normalized_runners,
            latest_rate_version: 1,
        };

        e.storage()
            .instance()
            .set(&DataKey::Agent(agent_id), &record);

        let rate_card: RateCard = RateCard::from(initial_rate_card);
        write_rate_card(&e, agent_id, 1, &rate_card);

        agent_id
    }

    pub fn set_metadata_uri(e: Env, agent_id: u32, metadata_uri: Option<String>) {
        let mut record = read_agent_or_panic(&e, agent_id);
        record.developer.require_auth();
        record.metadata_uri = metadata_uri;
        e.storage()
            .instance()
            .set(&DataKey::Agent(agent_id), &record);
    }

    pub fn add_runner(e: Env, agent_id: u32, runner: Address) {
        let mut record = read_agent_or_panic(&e, agent_id);
        record.developer.require_auth();

        if !contains_address(&record.runners, &runner) {
            record.runners.push_back(runner.clone());
        }

        e.storage()
            .instance()
            .set(&DataKey::Agent(agent_id), &record);
    }

    pub fn remove_runner(e: Env, agent_id: u32, runner: Address) {
        let mut record = read_agent_or_panic(&e, agent_id);
        record.developer.require_auth();

        let mut filtered = Vec::new(&e);
        for existing in record.runners.iter() {
            if existing != runner {
                filtered.push_back(existing);
            }
        }

        if filtered.len() == 0 {
            panic_with_error!(&e, AgentRegistryError::InvalidRunnerList);
        }

        if filtered.len() == record.runners.len() {
            panic_with_error!(&e, AgentRegistryError::RunnerNotFound);
        }

        record.runners = filtered;
        e.storage()
            .instance()
            .set(&DataKey::Agent(agent_id), &record);
    }

    pub fn publish_rate_card(e: Env, agent_id: u32, rate_card: RateCardInput) -> u32 {
        if !rate_card.rates.validate_non_negative() {
            panic_with_error!(&e, AgentRegistryError::InvalidRates);
        }
        let mut record = read_agent_or_panic(&e, agent_id);
        record.developer.require_auth();

        let next_version = record.latest_rate_version + 1;
        let converted: RateCard = RateCard::from(rate_card);
        write_rate_card(&e, agent_id, next_version, &converted);

        record.latest_rate_version = next_version;
        e.storage()
            .instance()
            .set(&DataKey::Agent(agent_id), &record);

        next_version
    }

    pub fn get_agent(e: Env, agent_id: u32) -> AgentDetails {
        let record = read_agent_or_panic(&e, agent_id);
        AgentDetails {
            agent_id,
            developer: record.developer,
            metadata_uri: record.metadata_uri,
            runners: record.runners,
            latest_rate_version: record.latest_rate_version,
        }
    }

    pub fn get_rate_card(e: Env, agent_id: u32, version: u32) -> RateCard {
        match e
            .storage()
            .instance()
            .get::<_, RateCard>(&DataKey::RateCard(agent_id, version))
        {
            Some(card) => card,
            None => panic_with_error!(&e, AgentRegistryError::AgentNotFound),
        }
    }

    pub fn latest_rate_version(e: Env, agent_id: u32) -> u32 {
        let record = read_agent_or_panic(&e, agent_id);
        record.latest_rate_version
    }

    pub fn is_runner(e: Env, agent_id: u32, runner: Address) -> bool {
        let record = read_agent_or_panic(&e, agent_id);
        contains_address(&record.runners, &runner)
    }

    pub fn developer_of(e: Env, agent_id: u32) -> Address {
        let record = read_agent_or_panic(&e, agent_id);
        record.developer
    }
}

fn next_agent_id_and_increment(e: &Env) -> u32 {
    let current = match e.storage().instance().get::<_, u32>(&DataKey::NextAgentId) {
        Some(id) => id,
        None => 1,
    };
    let next = current.checked_add(1).unwrap();
    e.storage().instance().set(&DataKey::NextAgentId, &next);
    current
}

fn read_agent_or_panic(e: &Env, agent_id: u32) -> AgentRecord {
    match e
        .storage()
        .instance()
        .get::<_, AgentRecord>(&DataKey::Agent(agent_id))
    {
        Some(record) => record,
        None => panic_with_error!(e, AgentRegistryError::AgentNotFound),
    }
}

fn write_rate_card(e: &Env, agent_id: u32, version: u32, rate_card: &RateCard) {
    e.storage()
        .instance()
        .set(&DataKey::RateCard(agent_id, version), rate_card);
}

fn contains_address(vec: &Vec<Address>, addr: &Address) -> bool {
    let target = addr.clone();
    for existing in vec.iter() {
        if existing == target {
            return true;
        }
    }
    false
}
