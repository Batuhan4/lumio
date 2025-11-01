extern crate std;

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String, Vec};

use crate::{
    types::{RateCardInput, UsageMeterRates},
    AgentRegistry, AgentRegistryClient,
};

fn register_contract(e: &Env) -> AgentRegistryClient<'_> {
    let contract_id = e.register(AgentRegistry, ());
    AgentRegistryClient::new(e, &contract_id)
}

fn hash(e: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(e, &[byte; 32])
}

fn sample_rates() -> UsageMeterRates {
    UsageMeterRates {
        llm_in: 10_000_000,
        llm_out: 20_000_000,
        http_calls: 1_000_000,
        runtime_ms: 1000,
    }
}

#[test]
fn register_agent_sets_initial_state() {
    let e = Env::default();
    let developer = Address::generate(&e);
    let runner = Address::generate(&e);
    let metadata = Some(String::from_str(&e, "ipfs://agent"));
    let mut runners = Vec::new(&e);
    runners.push_back(runner.clone());
    let client = register_contract(&e);

    e.mock_all_auths();
    let rate_card = RateCardInput {
        rates: sample_rates(),
        manifest_hash: hash(&e, 1),
    };

    let agent_id = client.register_agent(&developer, &metadata, &runners, &rate_card);
    assert_eq!(agent_id, 1);

    let details = client.get_agent(&agent_id);
    assert_eq!(details.developer, developer);
    assert_eq!(details.metadata_uri, metadata);
    assert_eq!(details.runners.len(), 1);
    assert_eq!(details.latest_rate_version, 1);

    let stored_rate = client.get_rate_card(&agent_id, &1);
    assert_eq!(stored_rate.rates.llm_in, rate_card.rates.llm_in);
    assert_eq!(stored_rate.manifest_hash, rate_card.manifest_hash);
    assert!(client.is_runner(&agent_id, &runner));
    assert_eq!(client.developer_of(&agent_id), developer);
}

#[test]
fn publish_rate_card_increments_version() {
    let e = Env::default();
    let developer = Address::generate(&e);
    let runner = Address::generate(&e);
    let mut runners = Vec::new(&e);
    runners.push_back(runner);
    let client = register_contract(&e);
    e.mock_all_auths();

    let base_rate = RateCardInput {
        rates: sample_rates(),
        manifest_hash: hash(&e, 1),
    };
    let agent_id = client.register_agent(&developer, &None, &runners, &base_rate);

    let new_rate = RateCardInput {
        rates: UsageMeterRates {
            llm_in: 15_000_000,
            ..sample_rates()
        },
        manifest_hash: hash(&e, 2),
    };
    let version = client.publish_rate_card(&agent_id, &new_rate);
    assert_eq!(version, 2);

    let details = client.get_agent(&agent_id);
    assert_eq!(details.latest_rate_version, 2);
    let stored_new = client.get_rate_card(&agent_id, &2);
    assert_eq!(stored_new.rates.llm_in, new_rate.rates.llm_in);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn cannot_remove_last_runner() {
    let e = Env::default();
    let developer = Address::generate(&e);
    let runner = Address::generate(&e);
    let mut runners = Vec::new(&e);
    runners.push_back(runner.clone());

    let client = register_contract(&e);
    e.mock_all_auths();
    let rate_card = RateCardInput {
        rates: sample_rates(),
        manifest_hash: hash(&e, 1),
    };
    let agent_id = client.register_agent(&developer, &None, &runners, &rate_card);

    client.remove_runner(&agent_id, &runner);
}
