#include "noviscia/addresses.hpp"

namespace noviscia {
namespace addresses {

Pda config(const Pubkey& program_id) { return derive(program_id, seeds::CAPACITY); }
Pda congestion(const Pubkey& program_id) { return derive(program_id, seeds::CONGESTION); }
Pda client(const Pubkey& operator_, const Pubkey& program_id) {
    return derive(program_id, seeds::CLIENT, operator_);
}
Pda slot_ledger(const Pubkey& operator_, const Pubkey& program_id) {
    return derive(program_id, seeds::SLOT_LEDGER, operator_);
}
Pda treasury(const Pubkey& program_id) { return derive(program_id, seeds::TREASURY); }
Pda treasury_auth(const Pubkey& program_id) { return derive(program_id, seeds::TREASURY_AUTH); }

Pda marketplace(const Pubkey& program_id) { return derive(program_id, seeds::MARKETPLACE); }
Pda mm_registration(const Pubkey& mm, const Pubkey& program_id) {
    return derive(program_id, seeds::MM, mm);
}

Pda asset_registry(const Pubkey& program_id) { return derive(program_id, seeds::ASSET_REGISTRY); }
Pda asset_pool(const Pubkey& mint, const Pubkey& program_id) {
    return derive(program_id, seeds::ASSET_POOL, mint);
}
Pda asset_vault(const Pubkey& mint, const Pubkey& program_id) {
    return derive(program_id, seeds::ASSET_VAULT, mint);
}
Pda asset_fee_vault(const Pubkey& mint, const Pubkey& program_id) {
    return derive(program_id, seeds::ASSET_FEES, mint);
}
Pda asset_authority(const Pubkey& mint, const Pubkey& program_id) {
    return derive(program_id, seeds::ASSET_AUTHORITY, mint);
}
Pda credit_line(const Pubkey& institution, const Pubkey& program_id) {
    return derive(program_id, seeds::CREDIT_LINE, institution);
}
Pda desk_position(const Pubkey& institution, const Pubkey& mint, const Pubkey& program_id) {
    return derive(program_id, seeds::DESK_POSITION, institution, mint);
}

}  // namespace addresses
}  // namespace noviscia