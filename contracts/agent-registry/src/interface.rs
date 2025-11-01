use soroban_sdk::{contractclient, Address, Env, String, Vec};

use crate::types::{AgentDetails, RateCard, RateCardInput};

/// Client-only interface for invoking the AgentRegistry contract.
#[allow(dead_code)]
#[contractclient(name = "AgentRegistryClient")]
pub trait AgentRegistryInterface {
    fn init(env: Env);

    fn register_agent(
        env: Env,
        developer: Address,
        metadata_uri: Option<String>,
        runners: Vec<Address>,
        initial_rate_card: RateCardInput,
    ) -> u32;

    fn set_metadata_uri(env: Env, agent_id: u32, metadata_uri: Option<String>);

    fn add_runner(env: Env, agent_id: u32, runner: Address);

    fn remove_runner(env: Env, agent_id: u32, runner: Address);

    fn publish_rate_card(env: Env, agent_id: u32, rate_card: RateCardInput) -> u32;

    fn get_agent(env: Env, agent_id: u32) -> AgentDetails;

    fn get_rate_card(env: Env, agent_id: u32, version: u32) -> RateCard;

    fn latest_rate_version(env: Env, agent_id: u32) -> u32;

    fn is_runner(env: Env, agent_id: u32, runner: Address) -> bool;

    fn developer_of(env: Env, agent_id: u32) -> Address;
}
