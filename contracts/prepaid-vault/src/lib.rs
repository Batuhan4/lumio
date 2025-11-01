#![no_std]
#![allow(clippy::too_many_arguments)]

mod contract;
mod storage;
mod types;
mod utils;

pub use contract::PrepaidVault;
pub use types::{
    PolicyInput, RunLifecycle, RunReceipt, RunSettlement, UsageBreakdown, UserPolicy, VaultError,
};

#[cfg(test)]
mod test;
