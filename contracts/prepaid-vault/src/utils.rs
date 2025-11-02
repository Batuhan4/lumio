use agent_registry::UsageMeterRates;
use soroban_sdk::Env;

use crate::types::UsageBreakdown;

pub fn compute_charge(rates: &UsageMeterRates, usage: &UsageBreakdown) -> Option<i128> {
    let mut total: i128 = 0;
    total = total.checked_add(rates.llm_in.checked_mul(usage.llm_in)?)?;
    total = total.checked_add(rates.llm_out.checked_mul(usage.llm_out)?)?;
    total = total.checked_add(rates.http_calls.checked_mul(usage.http_calls)?)?;
    total = total.checked_add(rates.runtime_ms.checked_mul(usage.runtime_ms)?)?;
    Some(total)
}

pub fn validate_non_negative_usage(usage: &UsageBreakdown) -> bool {
    usage.llm_in >= 0 && usage.llm_out >= 0 && usage.http_calls >= 0 && usage.runtime_ms >= 0
}

pub fn current_day(env: &Env) -> u64 {
    let timestamp = env.ledger().timestamp();
    timestamp / 86_400
}
