#![no_std]
#![allow(clippy::too_many_arguments)]

#[cfg(feature = "contract")]
mod contract;

#[cfg(feature = "contract")]
mod storage;

#[cfg(feature = "interface")]
mod interface;
mod types;

#[cfg(feature = "contract")]
pub use contract::AgentRegistry;

#[cfg(all(feature = "contract", not(feature = "interface")))]
pub use contract::AgentRegistryClient;

#[cfg(feature = "interface")]
pub use interface::AgentRegistryClient;

pub use types::{AgentDetails, RateCard, RateCardInput, UsageMeterRates};

#[cfg(test)]
mod test;
