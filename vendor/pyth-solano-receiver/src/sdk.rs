//! Thin client-side helpers used by position-tracker's integration test:
//! account/instruction builders + the accumulator-parse helpers. Trimmed from
//! upstream `pyth-solana-receiver/src/sdk.rs` (commit 4f7d3c5) to the sets
//! used by `post_update_atomic` + governance. Apache-2.0.

use {
    crate::{accounts, instruction, ID},
    anchor_lang::{prelude::Pubkey, system_program, InstructionData, Result, ToAccountMetas},
    pyth_solana_receiver_sdk::{
        config::{Config, DataSource},
        pda::{get_config_address, get_treasury_address},
        PostUpdateAtomicParams,
    },
    pythnet_sdk::wire::v1::{AccumulatorUpdateData, MerklePriceUpdate, Proof},
    rand::Rng,
    solana_program::instruction::Instruction,
    wormhole_core_bridge_solana::state::GuardianSet,
};

pub const DEFAULT_TREASURY_ID: u8 = 0;

impl accounts::Initialize {
    pub fn populate(payer: &Pubkey) -> Self {
        Self {
            payer: *payer,
            config: get_config_address(),
            system_program: system_program::ID,
        }
    }
}

impl accounts::PostUpdateAtomic {
    pub fn populate(
        payer: &Pubkey,
        wormhole_address: &Pubkey,
        guardian_set_index: u32,
        price_update_account: Pubkey,
        treasury_id: u8,
    ) -> Self {
        let guardian_set = get_guardian_set_address(*wormhole_address, guardian_set_index);
        Self {
            payer: *payer,
            guardian_set,
            config: get_config_address(),
            treasury: get_treasury_address(treasury_id),
            price_update_account,
            system_program: system_program::ID,
            write_authority: *payer,
        }
    }
}

impl accounts::Governance {
    pub fn populate(payer: Pubkey) -> Self {
        Self {
            payer,
            config: get_config_address(),
        }
    }
}

impl accounts::AcceptGovernanceAuthorityTransfer {
    pub fn populate(payer: Pubkey) -> Self {
        Self {
            payer,
            config: get_config_address(),
        }
    }
}

impl accounts::ReclaimRent {
    pub fn populate(payer: Pubkey, price_update_account: Pubkey) -> Self {
        Self {
            payer,
            price_update_account,
        }
    }
}

impl instruction::Initialize {
    pub fn populate(payer: &Pubkey, initial_config: Config) -> Instruction {
        Instruction {
            program_id: ID,
            accounts: accounts::Initialize::populate(payer).to_account_metas(None),
            data: instruction::Initialize { initial_config }.data(),
        }
    }
}

impl instruction::PostUpdateAtomic {
    pub fn populate(
        payer: &Pubkey,
        wormhole_address: &Pubkey,
        guardian_set_index: u32,
        price_update_account: Pubkey,
        merkle_price_update: MerklePriceUpdate,
        vaa: Vec<u8>,
        treasury_id: u8,
    ) -> Instruction {
        let accounts = accounts::PostUpdateAtomic::populate(
            payer,
            wormhole_address,
            guardian_set_index,
            price_update_account,
            treasury_id,
        )
        .to_account_metas(None);

        Instruction {
            program_id: ID,
            accounts,
            data: instruction::PostUpdateAtomic {
                params: PostUpdateAtomicParams {
                    vaa,
                    merkle_price_update,
                    treasury_id,
                },
            }
            .data(),
        }
    }
}

impl instruction::SetDataSources {
    pub fn populate(payer: Pubkey, data_sources: Vec<DataSource>) -> Instruction {
        let accounts = accounts::Governance::populate(payer).to_account_metas(None);
        Instruction {
            program_id: ID,
            accounts,
            data: instruction::SetDataSources {
                valid_data_sources: data_sources,
            }
            .data(),
        }
    }
}

impl instruction::SetFee {
    pub fn populate(payer: Pubkey, fee: u64) -> Instruction {
        let accounts = accounts::Governance::populate(payer).to_account_metas(None);
        Instruction {
            program_id: ID,
            accounts,
            data: instruction::SetFee {
                single_update_fee_in_lamports: fee,
            }
            .data(),
        }
    }
}

impl instruction::SetWormholeAddress {
    pub fn populate(payer: Pubkey, wormhole: Pubkey) -> Instruction {
        let accounts = accounts::Governance::populate(payer).to_account_metas(None);
        Instruction {
            program_id: ID,
            accounts,
            data: instruction::SetWormholeAddress { wormhole }.data(),
        }
    }
}

impl instruction::SetMinimumSignatures {
    pub fn populate(payer: Pubkey, minimum_signatures: u8) -> Instruction {
        let accounts = accounts::Governance::populate(payer).to_account_metas(None);
        Instruction {
            program_id: ID,
            accounts,
            data: instruction::SetMinimumSignatures { minimum_signatures }.data(),
        }
    }
}

impl instruction::RequestGovernanceAuthorityTransfer {
    pub fn populate(payer: Pubkey, target_governance_authority: Pubkey) -> Instruction {
        let accounts = accounts::Governance::populate(payer).to_account_metas(None);
        Instruction {
            program_id: ID,
            accounts,
            data: instruction::RequestGovernanceAuthorityTransfer {
                target_governance_authority,
            }
            .data(),
        }
    }
}

impl instruction::CancelGovernanceAuthorityTransfer {
    pub fn populate(payer: Pubkey) -> Instruction {
        let accounts = accounts::Governance::populate(payer).to_account_metas(None);
        Instruction {
            program_id: ID,
            accounts,
            data: instruction::CancelGovernanceAuthorityTransfer {}.data(),
        }
    }
}

impl instruction::AcceptGovernanceAuthorityTransfer {
    pub fn populate(payer: Pubkey) -> Instruction {
        let accounts =
            accounts::AcceptGovernanceAuthorityTransfer::populate(payer).to_account_metas(None);
        Instruction {
            program_id: ID,
            accounts,
            data: instruction::AcceptGovernanceAuthorityTransfer {}.data(),
        }
    }
}

impl instruction::ReclaimRent {
    pub fn populate(payer: Pubkey, price_update_account: Pubkey) -> Instruction {
        let accounts =
            accounts::ReclaimRent::populate(payer, price_update_account).to_account_metas(None);
        Instruction {
            program_id: ID,
            accounts,
            data: instruction::ReclaimRent {}.data(),
        }
    }
}

pub fn get_guardian_set_address(wormhole_address: Pubkey, guardian_set_index: u32) -> Pubkey {
    Pubkey::find_program_address(
        &[
            GuardianSet::SEED_PREFIX,
            guardian_set_index.to_be_bytes().as_ref(),
        ],
        &wormhole_address,
    )
    .0
}

pub fn deserialize_accumulator_update_data(
    accumulator_message: Vec<u8>,
) -> Result<(Vec<u8>, Vec<MerklePriceUpdate>)> {
    let accumulator_update_data =
        AccumulatorUpdateData::try_from_slice(accumulator_message.as_slice()).unwrap();

    match accumulator_update_data.proof {
        Proof::WormholeMerkle { vaa, updates } => return Ok((vaa.as_ref().to_vec(), updates)),
    }
}

pub fn get_random_treasury_id() -> u8 {
    rand::thread_rng().gen()
}
