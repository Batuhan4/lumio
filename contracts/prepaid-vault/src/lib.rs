#![no_std]
#![allow(clippy::too_many_arguments)]

mod contract;
mod storage;
mod types;
mod utils;

pub use contract::PrepaidVault;
pub use types::{
    PolicyInput, RunFinalizedLog, RunLifecycle, RunOpenedLog, RunReceipt, RunSettlement,
    RunnerGrant, RunnerGrantLog, RunnerRevokeLog, UsageBreakdown, UserPolicy, VaultError,
};

#[cfg(test)]
mod test;
