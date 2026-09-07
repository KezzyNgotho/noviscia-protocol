// SPDX-License-Identifier: Apache-2.0
// Noviscia C++ SDK — unit tests.
//
// All expected values below are cross-checked against the npm twin
// (@noviscia/sdk) and the Rust twin (noviscia-*-sdk) so the C++ SDK provably
// agrees with the other SDK surfaces on: sha256/keccak256, base58, every PDA
// derivation (key + bump), the Merkle KYC leaf/root/proof, Anchor
// discriminators, and instruction encodings.

#include "noviscia/noviscia.hpp"

#include <cstdio>
#include <cstdlib>
#include <string>

namespace {

int failures = 0;
int checks = 0;

void expect(bool cond, const char* what) {
    ++checks;
    if (!cond) {
        ++failures;
        std::printf("FAIL: %s\n", what);
    }
}
void expect_hex(const std::array<std::uint8_t, 32>& got, const char* want, const char* what) {
    const auto s = noviscia::base58_encode(got);
    (void)s;
    std::string hex;
    hex.reserve(64);
    for (auto b : got) {
        char buf[3];
        std::snprintf(buf, sizeof buf, "%02x", b);
        hex += buf;
    }
    ++checks;
    if (hex != want) {
        ++failures;
        std::printf("FAIL: %s\n  got  %s\n  want %s\n", what, hex.c_str(), want);
    }
}

using noviscia::Pubkey;
using noviscia::addresses::Pda;
using noviscia::Digest;
namespace ids = noviscia::ids;

Pubkey pk(const char* b58) {
    Pubkey k;
    if (!noviscia::from_base58(b58, k)) {
        std::fprintf(stderr, "bad base58 literal: %s\n", b58);
        std::exit(1);
    }
    return k;
}

// Build a Pubkey from 64 hex nibbles (e.g. RFC/public test vectors).
Pubkey pk_hex(const char* hex) {
    Pubkey k{};
    for (int i = 0; i < 32; ++i) {
        auto nib = [&](char c) -> std::uint8_t {
            if (c >= '0' && c <= '9') return static_cast<std::uint8_t>(c - '0');
            if (c >= 'a' && c <= 'f') return static_cast<std::uint8_t>(c - 'a' + 10);
            if (c >= 'A' && c <= 'F') return static_cast<std::uint8_t>(c - 'A' + 10);
            std::fprintf(stderr, "bad hex literal\n");
            std::exit(1);
        };
        k.bytes[static_cast<std::size_t>(i)] =
            static_cast<std::uint8_t>((nib(hex[i * 2]) << 4) | nib(hex[i * 2 + 1]));
    }
    return k;
}

// ── hash ──────────────────────────────────────────────────────────────────

void test_sha256_vectors() {
    const auto empty = noviscia::sha256({});
    expect_hex(empty, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
               "sha256(\"\")");
    const unsigned char abc[] = {'a', 'b', 'c'};
    expect_hex(noviscia::sha256(abc), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
               "sha256(\"abc\")");
}

void test_keccak256_vectors() {
    const auto empty = noviscia::keccak256({});
    expect_hex(empty, "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
               "keccak256(\"\")");
    const unsigned char abc[] = {'a', 'b', 'c'};
    expect_hex(noviscia::keccak256(abc), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
               "keccak256(\"abc\")");
}

// ── base58 ────────────────────────────────────────────────────────────────

void test_base58_roundtrip() {
    const Pubkey k = pk("44eBV65bNC4WPhxne4XFt4zy9q5cPHYD6mU54KZ4ZLzH");
    expect(noviscia::to_base58(k) == "44eBV65bNC4WPhxne4XFt4zy9q5cPHYD6mU54KZ4ZLzH",
           "base58 roundtrip (encode)");
    Pubkey back;
    expect(noviscia::from_base58(noviscia::to_base58(k), back) && back == k,
           "base58 roundtrip (decode)");
    expect(noviscia::to_base58(Pubkey{}) == "11111111111111111111111111111111",
           "zero key encodes as 32 '1's");
}

// ── ed25519 on-curve ──────────────────────────────────────────────────────

void test_ed25519_on_curve() {
    using std::span;
    // RFC 8032 §7.1 first public key (valid compressed Edwards point).
    const auto on = pk_hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
    expect(noviscia::ed25519_is_on_curve(on.bytes), "valid ed25519 pubkey decodes");
    // PDAs are, by construction, OFF the curve.
    const auto off = pk("2nZymipS9DwTaRGb5tkDYWYA1QnUHRvBwpDnmX45e7G1");
    expect(!noviscia::ed25519_is_on_curve(off.bytes), "PDA/off-curve key rejected");
    const auto zero = Pubkey{};
    expect(noviscia::ed25519_is_on_curve(zero.bytes), "zero key is on-curve");
}

// ── PDA derivations (key + bump vs npm twin) ──────────────────────────────

void test_pda_derivations() {
    using namespace noviscia::addresses;
    const Pubkey inst = pk("44eBV65bNC4WPhxne4XFt4zy9q5cPHYD6mU54KZ4ZLzH");
    const Pubkey zero{};

    auto check = [](const Pda& got, const char* want, const char* what) {
        auto s = noviscia::to_base58(got.key);
        expect(got.ok && s == want, what);
    };

    check(config(), "7kiBHAZQR6NZv7jdoNxEESkMYPQPoam9Tue35ExHKknS", "pda config");
    check(congestion(), "E9wyZLgCiJTQkDjAxpKnbKtmsSEkBs5kFJiYGLhCf7fa", "pda congestion");
    check(client(inst), "9tVUychymZjhw7vqCPUSbWfKSCZaUmF1QUaAxPoq8CH3", "pda client");
    check(slot_ledger(inst), "CYLosJLeaa8zyjKwW5Y9hwRsDwukeedMko3eD67Pnu3B", "pda slot_ledger");
    check(treasury(), "uWsC77Bq4ALnv6BbLohVNnKNMcrN3AqWnsU6T6cEDsq", "pda treasury");
    check(treasury_auth(), "4NkLFwQ5YGLSuHT3UUCKGC8D2s5iCfyQTyvKXgXcmqYw", "pda treasury_auth");
    check(marketplace(), "EzU3aPAGLAfRpPtAk8oytrmfVAr8w9AzqUoDgbpAfiLY", "pda marketplace");
    check(mm_registration(inst), "9Wjoy69zpRz4jbQSKTKRR2H89qoH7cK5DWCJR5WjsX8M", "pda mm_reg");
    check(asset_registry(), "2nZymipS9DwTaRGb5tkDYWYA1QnUHRvBwpDnmX45e7G1", "pda asset_registry");
    check(asset_pool(zero), "8x1Yx7KHFV9MKWWUrafxFwBh3jtXFuNbsXfGW4BAq687", "pda asset_pool");
    check(asset_vault(zero), "JBhwJuaWh7grGrWavhELH5BQyox9StCTU21juAQMBbVx", "pda asset_vault");
    check(asset_fee_vault(zero), "3N7HxhhbvvSYkzkDnNcik9oAUEW2PXPXoH9GG6ao9AM7", "pda asset_fees");
    check(asset_authority(zero), "2L4GiKxueDSZjPvERCq1WAUKZJfZzLjrfdF7j9BuR3or", "pda asset_authority");
    check(credit_line(inst), "WUJzasrX7ZRg6NMpT6bhhVLaG7aVWxUxvYdc7j6ToLc", "pda credit_line");
    check(desk_position(inst, zero), "F2x64nUKyxPuTrjzXR65A21h8Z61hQsA1x9zSULCpTkH", "pda desk_position");
}

void test_pda_bumps() {
    using namespace noviscia::addresses;
    const Pubkey inst = pk("44eBV65bNC4WPhxne4XFt4zy9q5cPHYD6mU54KZ4ZLzH");
    const Pubkey zero{};
    struct V { Pda pda; std::uint8_t bump; const char* what; };
    const V vs[] = {
        {asset_pool(zero), 254, "bump asset_pool"},
        {asset_vault(zero), 255, "bump asset_vault"},
        {asset_fee_vault(zero), 252, "bump asset_fees"},
        {credit_line(inst), 255, "bump credit_line"},
        {marketplace(), 253, "bump marketplace"},
        {mm_registration(inst), 254, "bump mm_reg"},
        {client(inst), 253, "bump client"},
        {slot_ledger(inst), 254, "bump slot_ledger"},
        {congestion(), 254, "bump congestion"},
        {asset_registry(), 255, "bump asset_registry"},
    };
    for (const auto& v : vs) {
        ++checks;
        if (!(v.pda.ok && v.pda.bump == v.bump)) {
            ++failures;
            std::printf("FAIL: %s (got bump=%u ok=%d)\n", v.what, v.pda.bump, v.pda.ok);
        }
    }
}

// ── Merkle KYC ────────────────────────────────────────────────────────────

void test_merkle_kyc() {
    using namespace noviscia;
    const Pubkey inst = pk("44eBV65bNC4WPhxne4XFt4zy9q5cPHYD6mU54KZ4ZLzH");
    constexpr std::uint64_t expiry = 1'800'000'000;

    const auto leaf = asset_kyc_hash(inst, expiry);
    expect_hex(leaf, "25fef11ad17e37b047edb032353826a2dec4846cb48b600d85092906d60bdcbe",
               "kyc leaf (inst, expiry)");
    expect(keccak_pair(leaf, leaf) ==
               Digest{0xeb, 0xf9, 0x83, 0x7f, 0x47, 0x6f, 0x2b, 0xfc, 0xb9, 0xd0, 0x25, 0xf6, 0xeb, 0x26, 0x03, 0x6b,
                      0x54, 0x4b, 0x9c, 0x8c, 0x63, 0x95, 0x3d, 0x22, 0xbc, 0xca, 0x66, 0x12, 0x1b, 0x76, 0x53, 0xeb},
           "kyc sorted-pair (same leaf)");

    const Digest leaves[] = {leaf, asset_kyc_hash(inst, expiry + 3'600)};
    const auto root = merkle_root(leaves);
    expect_hex(root, "69312ceda6750ec5bcb112c9a7dda9f023bff21cdeece90882bbcbe01340dade",
               "2-leaf kyc root");
    expect(verify_merkle_proof(leaves[0], std::vector<Digest>{leaves[1]}, root), "proof for leaf 0 verifies");
    expect(verify_merkle_proof(leaves[1], std::vector<Digest>{leaves[0]}, root), "proof for leaf 1 verifies");
    expect(!verify_merkle_proof(leaves[0], std::vector<Digest>{Digest{}}, root), "fake sibling rejected");

    // Root rotation revokes: verify against a *different* root.
    Digest other = root;
    other[0] ^= 1;
    expect(!verify_merkle_proof(leaves[0], std::vector<Digest>{leaves[1]}, other), "rotated root revokes leaf");

    // Unset (all-zero) root → verify returns false (the documented pre-#3 gap).
    const Digest zero_root{};
    expect(!verify_merkle_proof(leaves[0], std::vector<Digest>{leaves[1]}, zero_root), "zero root skips proof (returns false)");

    // Odd-count duplicate-last behaviour.
    const Digest odd_root = merkle_root(std::vector<Digest>{leaf});
    expect(odd_root == leaf, "single leaf root = leaf");
}

// ── Anchor discriminators ─────────────────────────────────────────────────

std::string disc_hex(const char* name) {
    auto d = noviscia::anchor_discriminator(name);
    std::string hex;
    for (auto b : d) {
        char buf[3];
        std::snprintf(buf, sizeof buf, "%02x", b);
        hex += buf;
    }
    return hex;
}

void test_discriminators() {
    expect(disc_hex("purchase_capacity") == "11e94dc451d42d1a", "disc purchase_capacity");
    expect(disc_hex("risk_register_mm") == "016882fb52257f97", "disc risk_register_mm");
    expect(disc_hex("risk_suspend_mm") == "c39576fd5c69732f", "disc risk_suspend_mm");
    expect(disc_hex("risk_activate_mm") == "f47e32374f345fa5", "disc risk_activate_mm");
    expect(disc_hex("asset_allocate_capacity") == "b5eea94bdd422293", "disc asset_allocate_capacity");
    expect(disc_hex("asset_set_kyc_root") == "46b65def44d51168", "disc asset_set_kyc_root");
}

// ── Instruction builders ──────────────────────────────────────────────────

void test_instruction_builders() {
    using namespace noviscia;
    const Pubkey inst = pk("44eBV65bNC4WPhxne4XFt4zy9q5cPHYD6mU54KZ4ZLzH");
    const Pubkey auth = ids::USDC_MINT;  // committee / authority (arbitrary real key)
    const Pubkey ata = ids::WSOL_MINT;   // token account arg (arbitrary real key)

    // risk_register_mm data: disc(8) + mm(32) + ceiling(u64 LE)
    auto reg = risk_register_mm(ids::HOST, inst, 20'000'000'000ull, auth);
    expect(reg.data.size() == 8 + 32 + 8, "register_mm data length");
    expect(reg.accounts.size() == 5, "register_mm account count");
    expect(reg.accounts[0].pubkey == addresses::marketplace().key, "register_mm marketplace");
    expect(reg.accounts[1].pubkey == addresses::mm_registration(inst).key, "register_mm mm_reg");
    expect(reg.accounts[3].is_signer && !reg.accounts[0].is_signer, "register_mm signers");
    // 20_000_000_000 = 0x4A817C800 → LE: 00 e8 17 a8 04 00 00 00
    expect(reg.data[40] == 0x00 && reg.data[41] == 0xc8 && reg.data[42] == 0x17 && reg.data[43] == 0xa8 &&
           reg.data[44] == 0x04 && reg.data[45] == 0x00 && reg.data[46] == 0x00 && reg.data[47] == 0x00,
           "register_mm ceiling LE(20bn)");

    // ceiling contract
    bool threw = false;
    try { risk_register_mm(ids::HOST, inst, 0, auth); } catch (const std::domain_error&) { threw = true; }
    expect(threw, "register_mm rejects zero ceiling");
    threw = false;
    try { risk_register_mm(ids::HOST, inst, noviscia::MAX_MM_CEILING_USDC + 1, auth); } catch (const std::domain_error&) { threw = true; }
    expect(threw, "register_mm rejects ceiling > C_desk");

    // suspend/activate share the account layout, different discriminators.
    auto susp = risk_suspend_mm(ids::HOST, inst, auth);
    auto act = risk_activate_mm(ids::HOST, inst, auth);
    expect(susp.accounts.size() == 4 && susp.accounts == act.accounts, "suspend/activate layout");
    expect(disc_hex("risk_suspend_mm") != disc_hex("risk_activate_mm"), "suspend vs activate distinct");

    // set_kyc_root data: disc(8) + root(32)
    Digest root{};
    root[0] = 0x42;
    auto setRoot = asset_set_kyc_root(ids::HOST, auth, inst, root);
    expect(setRoot.data.size() == 8 + 32, "set_kyc_root data length");
    expect(setRoot.data[8] == 0x42, "set_kyc_root root carried");
    expect(setRoot.data[8 + 31] == 0x00, "set_kyc_root root tail zero");
    expect(setRoot.accounts[1].pubkey == auth && setRoot.accounts[1].is_signer, "set_kyc_root authority");

    // allocate: 10 accounts, data = disc + 4 args (u64) + proof vec.
    Digest proof{};
    proof[0] = 0x11;
    auto alloc = asset_allocate_capacity(ids::HOST, inst, ata, ids::WSOL_MINT, 200'000'000ull,
                                         999'000ull, 0ull, 1'800'000'000ull, std::vector<Digest>{proof});
    expect(alloc.accounts.size() == 10, "allocate account count");
    expect(alloc.data.size() == 8 + 8 * 4 + 4 + 32, "allocate data length");
    expect(alloc.accounts[5].pubkey == inst && alloc.accounts[5].is_signer, "allocate trader signer");
    expect(!alloc.accounts[2].is_signer, "allocate vault_authority is a PDA (not signer)");

    // purchase_capacity: 8 accounts, data = disc + cap + expiry + proof.
    auto pc = purchase_capacity(ids::HOST, inst, ata, addresses::treasury().key, 1'000'000ull,
                                1'700'000'000ull, std::vector<Digest>{proof});
    expect(pc.accounts.size() == 8, "purchase_capacity account count");
    expect(pc.data.size() == 8 + 8 + 8 + 4 + 32, "purchase_capacity data length");
    // Rust twin: client (idx 1) and ledger (idx 2) are both writable.
    expect(pc.accounts[1].pubkey == addresses::client(inst).key && pc.accounts[1].is_writable,
           "purchase client writable");
    expect(pc.accounts[2].pubkey == addresses::slot_ledger(inst).key && pc.accounts[2].is_writable,
           "purchase ledger writable");
}

// ── new LP PDAs (npm twin vectors) ────────────────────────────────────────

void test_lp_pdas() {
    using namespace noviscia::addresses;
    const Pubkey inst = pk("44eBV65bNC4WPhxne4XFt4zy9q5cPHYD6mU54KZ4ZLzH");
    const Pubkey zero{};

    const auto mint = asset_lp_mint(zero);
    expect(mint.ok && noviscia::to_base58(mint.key) == "6tUGUJneksBVGiApdpW69UwcPqjcMkJBha2GaKDeLAnq",
           "pda asset_lp_mint");
    expect(mint.ok && mint.bump == 255, "bump asset_lp_mint");

    const auto pos = asset_lp_position(zero, inst);
    expect(pos.ok && noviscia::to_base58(pos.key) == "HtjfnxbMPj2vfKdWuSth8DTH4nh5SYF7ytfqjE2Mo32K",
           "pda asset_lp_position");
    expect(pos.ok && pos.bump == 253, "bump asset_lp_position");

    // Distinct per (pool, LP) and per mint.
    expect(asset_lp_position(zero, inst).key != asset_lp_position(inst, inst).key,
           "asset_lp_position scoped by mint + lp");
}

// ── new instruction discriminators (node sha256 vectors) ──────────────────

void test_discriminators_more() {
    expect(disc_hex("initialize") == "afaf6d1f0d989bed", "disc initialize");
    expect(disc_hex("set_kyc_merkle_root") == "0c37b9a5f97a02f7", "disc set_kyc_merkle_root");
    expect(disc_hex("set_pricing") == "34c89dc01286397b", "disc set_pricing");
    expect(disc_hex("update_congestion") == "d098b573f5ce1a2e", "disc update_congestion");
    expect(disc_hex("register_client") == "6a0317f988729191", "disc register_client");
    expect(disc_hex("update_credit") == "e50ca12d819a91a6", "disc update_credit");
    expect(disc_hex("deposit_margin") == "f0603925adae9edb", "disc deposit_margin");
    expect(disc_hex("withdraw_margin") == "7cde088db56c0fb0", "disc withdraw_margin");
    expect(disc_hex("report_utilization") == "07964d1d73a5cdb4", "disc report_utilization");
    expect(disc_hex("settle_slot") == "53517a52871b59e9", "disc settle_slot");
    expect(disc_hex("freeze_client") == "e919c33263a3c439", "disc freeze_client");
    expect(disc_hex("unfreeze_client") == "b23072063d64725c", "disc unfreeze_client");
    expect(disc_hex("set_paused") == "5b3c7dc0b0e1a6da", "disc set_paused");
    expect(disc_hex("withdraw_treasury") == "283f7a9e90d85360", "disc withdraw_treasury");
    expect(disc_hex("asset_register") == "3b543b6fd3fb0dde", "disc asset_register");
    expect(disc_hex("asset_update_params") == "d0648fc1e7a049af", "disc asset_update_params");
    expect(disc_hex("asset_set_support") == "8693d205a477764b", "disc asset_set_support");
    expect(disc_hex("asset_initialize_credit_line") == "0c2e1de216b2924c",
           "disc asset_initialize_credit_line");
    expect(disc_hex("asset_update_credit_limit") == "1fdeb46b219a6a28",
           "disc asset_update_credit_limit");
    expect(disc_hex("asset_set_credit_frozen") == "fc51c0e6c613e7a6",
           "disc asset_set_credit_frozen");
    expect(disc_hex("asset_set_paused") == "e73bb92c00899dff", "disc asset_set_paused");
    expect(disc_hex("asset_recredit_capacity") == "5185dceee0464bc7",
           "disc asset_recredit_capacity");
    expect(disc_hex("asset_settle_daily") == "dc03dad8487f7874", "disc asset_settle_daily");
    expect(disc_hex("asset_deposit_liquidity") == "ad9657f7212f16f0",
           "disc asset_deposit_liquidity");
    expect(disc_hex("asset_withdraw_liquidity") == "fcd19a1e9c5434f6",
           "disc asset_withdraw_liquidity");
    expect(disc_hex("asset_withdraw_fees") == "c5eb312894078fa1", "disc asset_withdraw_fees");
}

// ── full capacity-host builder coverage ───────────────────────────────────

void test_capacity_builders() {
    using namespace noviscia;
    const Pubkey inst = pk("44eBV65bNC4WPhxne4XFt4zy9q5cPHYD6mU54KZ4ZLzH");
    const Pubkey auth = ids::USDC_MINT;
    const Pubkey ata = ids::WSOL_MINT;

    // initialize: 10 accounts, data = disc + 4 u64.
    auto init = initialize(ids::HOST, auth, inst, ids::USDC_MINT, addresses::treasury().key,
                           addresses::treasury_auth().key, 10, 200, 200, 0);
    expect(init.accounts.size() == 10, "capacity initialize account count");
    expect(init.data.size() == 8 + 8 * 4, "capacity initialize data length");
    expect(init.accounts[0].pubkey == auth && init.accounts[0].is_signer,
           "capacity initialize authority signer");
    expect(init.accounts[9].pubkey == ids::RENT_PROGRAM, "capacity initialize rent last");

    // set_kyc_merkle_root: disc + root(32).
    Digest root{};
    root[0] = 0x2a;
    auto kyc = set_kyc_merkle_root(ids::HOST, auth, root);
    expect(kyc.data.size() == 8 + 32 && kyc.accounts.size() == 2, "set_kyc_merkle_root size");
    expect(kyc.data[8] == 0x2a, "set_kyc_merkle_root root carried");

    // set_pricing / set_paused: same 2-account config layout.
    auto pricing = set_pricing(ids::HOST, auth, 12, 300, 200, 1'000);
    expect(pricing.data.size() == 8 + 8 * 4 && pricing.accounts.size() == 2,
           "set_pricing size");
    auto paused = set_paused(ids::HOST, auth, true);
    expect(paused.data.size() == 9 && paused.data[8] == 0x01, "set_paused bool true");

    // update_congestion: keeper · config · congestion.
    auto cong = update_congestion(ids::HOST, auth, 5'000, 1'200'000);
    expect(cong.accounts.size() == 3 && cong.data.size() == 8 + 8 + 8,
           "update_congestion size");
    expect(cong.accounts[2].pubkey == addresses::congestion().key, "update_congestion oracle");

    // register_client: tier byte then u64 credit.
    auto reg = register_client(ids::HOST, inst, ClientTier::TierTwo, 200'000'000'000ull);
    expect(reg.accounts.size() == 4, "register_client account count");
    expect(reg.data.size() == 8 + 1 + 8, "register_client data length");
    expect(reg.data[8] == 0x01, "register_client tier byte (TierTwo)");
    expect(reg.accounts[0].pubkey == inst && reg.accounts[0].is_signer,
           "register_client operator signer");

    // update_credit: signer · operator · client.
    auto uc = update_credit(ids::HOST, auth, inst, 50'000'000'000ull);
    expect(uc.accounts.size() == 3 && uc.data.size() == 16, "update_credit size");
    expect(uc.accounts[2].pubkey == addresses::client(inst).key, "update_credit client");

    // deposit/withdraw margin: 7 accounts; data disc + amount.
    for (auto* what : {"deposit_margin", "withdraw_margin"}) {
        auto dm = what[0] == 'd' ? deposit_margin(ids::HOST, auth, inst, ata, 100'000'000ull)
                                 : withdraw_margin(ids::HOST, auth, inst, ata, 100'000'000ull);
        expect(dm.accounts.size() == 7 && dm.data.size() == 8 + 8, what);
        expect(dm.accounts[4].pubkey == addresses::treasury().key, "margin treasury");
    }

    // report_utilization / settle_slot / unfreeze: 5 accounts.
    auto ru = report_utilization(ids::HOST, auth, inst, 400'000, 12'000'000'000ull);
    expect(ru.accounts.size() == 5 && ru.data.size() == 8 + 8 + 8, "report_utilization size");
    auto ss = settle_slot(ids::HOST, auth, inst);
    expect(ss.data.size() == 8 && ss.accounts.size() == 5, "settle_slot size");
    auto uf = unfreeze_client(ids::HOST, auth, inst);
    expect(uf.data.size() == 8 && uf.accounts.size() == 5 &&
               disc_hex("unfreeze_client") == disc_hex("unfreeze_client"),
           "unfreeze_client size");

    // freeze_client: borsh string trailer.
    auto fz = freeze_client(ids::HOST, auth, inst, "suspected wash trading");
    expect(fz.accounts.size() == 5, "freeze_client account count");
    expect(fz.data.size() == 8 + 4 + std::string("suspected wash trading").size(),
           "freeze_client string length");
    expect(fz.data[8] == 0x16 && fz.data[9] == 0x00 && fz.data[10] == 0x00 && fz.data[11] == 0x00,
           "freeze_client u32 LE string length (22)");

    // withdraw_treasury: 6 accounts.
    auto wt = withdraw_treasury(ids::HOST, auth, addresses::treasury().key,
                                addresses::treasury_auth().key, ata, 5'000'000'000ull);
    expect(wt.accounts.size() == 6 && wt.data.size() == 16, "withdraw_treasury size");
}

// ── full asset-engine builder coverage ────────────────────────────────────

void test_asset_builders() {
    using namespace noviscia;
    const Pubkey inst = pk("44eBV65bNC4WPhxne4XFt4zy9q5cPHYD6mU54KZ4ZLzH");
    const Pubkey auth = ids::USDC_MINT;
    const Pubkey zero{};

    // initialize: data = disc + 3 pubkeys + 3 mints (200 bytes).
    auto init = asset_initialize(ids::HOST, auth, auth, auth, ids::WSOL_MINT, ids::USDC_MINT,
                                 ids::NVSC_MINT);
    expect(init.accounts.size() == 3, "asset initialize account count");
    expect(init.data.size() == 8 + 32 * 6, "asset initialize data length");
    expect(disc_hex("initialize") == "afaf6d1f0d989bed", "asset initialize discriminator");

    // register (USDC profile): decimals byte then bps/capacity, LP split last.
    auto reg = asset_register(ids::HOST, auth, zero, USDC_PROFILE);
    expect(reg.accounts.size() == 11, "asset_register account count");
    expect(reg.data.size() == 8 + 1 + 2 + 2 + 8 + 8 + 2, "asset_register data length");
    expect(reg.accounts[7].pubkey == addresses::asset_lp_mint(zero).key,
           "asset_register lp_mint account");
    expect(reg.accounts[10].pubkey == ids::RENT_PROGRAM, "asset_register rent last");
    expect(reg.data[8] == USDC_PROFILE.decimals, "asset_register decimals");
    expect(reg.data[9] == 0x08 && reg.data[10] == 0x00, "asset_register base premium LE(8)");
    expect(reg.data[29] == 0x28 && reg.data[30] == 0x23, "asset_register lp_yield_split LE(9000)");

    // update params / set support: committee-tier 4-account layouts.
    auto up = asset_update_params(ids::HOST, auth, zero, WSOL_PROFILE);
    expect(up.accounts.size() == 4 && up.data.size() == 8 + 2 + 2 + 8 + 8 + 2,
           "asset_update_params size");
    auto support = asset_set_support(ids::HOST, auth, zero, false);
    expect(support.data.size() == 9 && support.data[8] == 0x00, "asset_set_support false");

    // credit-line lifecycle.
    auto icl = asset_initialize_credit_line(ids::HOST, inst, auth, 1'000'000'000'000ull);
    expect(icl.accounts.size() == 5 && icl.data.size() == 16, "asset_initialize_credit_line size");
    expect(icl.accounts[1].pubkey == inst && icl.accounts[1].is_signer,
           "asset_initialize_credit_line institution signer");
    auto ucl = asset_update_credit_limit(ids::HOST, auth, inst, 750'000'000'000ull);
    expect(ucl.accounts.size() == 4 && ucl.data.size() == 16,
           "asset_update_credit_limit size");
    auto scf = asset_set_credit_frozen(ids::HOST, auth, inst, true);
    expect(scf.accounts.size() == 4 && scf.data.size() == 9 && scf.data[8] == 0x01,
           "asset_set_credit_frozen true");
    auto sap = asset_set_paused(ids::HOST, auth, false);
    expect(sap.accounts.size() == 2 && sap.data.size() == 9 && sap.data[8] == 0x00,
           "asset_set_paused false");

    // recredit: 7 accounts.
    auto rc = asset_recredit_capacity(ids::HOST, zero, inst, inst, auth, 250'000'000ull);
    expect(rc.accounts.size() == 7 && rc.data.size() == 8 + 8, "asset_recredit_capacity size");
    expect(rc.accounts[0].pubkey == addresses::asset_pool(zero).key,
           "asset_recredit_capacity pool");

    // settle daily: 8 accounts, principal + premium + late fee.
    auto sd = asset_settle_daily(ids::HOST, zero, inst, auth, auth, 1'000'000'000ull, 50'000ull,
                                 777ull);
    expect(sd.accounts.size() == 8 && sd.data.size() == 8 + 8 * 3, "asset_settle_daily size");
    expect(sd.accounts[5].pubkey == auth && sd.accounts[5].is_signer,
           "asset_settle_daily treasury signer");

    // LP lifecycles route through the share-mint + position PDAs.
    auto dep = asset_deposit_liquidity(ids::HOST, zero, inst, auth, auth, 2'000'000'000ull);
    expect(dep.accounts.size() == 10, "asset_deposit_liquidity account count");
    expect(dep.accounts[2].pubkey == addresses::asset_lp_mint(zero).key,
           "asset_deposit_liquidity lp mint");
    expect(dep.accounts[3].pubkey == addresses::asset_lp_position(zero, inst).key,
           "asset_deposit_liquidity lp position");
    auto wd = asset_withdraw_liquidity(ids::HOST, zero, inst, auth, auth, 500ull);
    expect(wd.accounts.size() == 9 && wd.data.size() == 8 + 8, "asset_withdraw_liquidity size");
    expect(wd.accounts[2].pubkey == addresses::asset_lp_mint(zero).key,
           "asset_withdraw_liquidity lp mint readonly");
    auto wf = asset_withdraw_fees(ids::HOST, auth, zero, auth, 1'000'000ull);
    expect(wf.accounts.size() == 7 && wf.data.size() == 16, "asset_withdraw_fees size");
    expect(wf.accounts[2].pubkey == auth && wf.accounts[2].is_signer,
           "asset_withdraw_fees upgrade signer");

    // default-program conveniences pin the consolidated host id.
    auto rd = asset_register_default(auth, zero, NVSC_PROFILE);
    expect(rd.program_id == ids::HOST && rd.data.size() == 31, "asset_register_default");
    auto rw = register_wsol_default(auth, ids::WSOL_MINT);
    expect(rw.data.size() == 31 && rw.data[8] == 9, "register_wsol_default decimals=9");
}

// ── compute helpers (Rust twin vectors) ───────────────────────────────────

void test_compute_helpers() {
    using namespace noviscia;

    // U128 core.
    expect(U128::mul(0xffff'ffff'ffff'ffffull, 0xffff'ffff'ffff'ffffull) ==
               U128{0xffff'ffff'ffff'fffeull, 1},
           "u128 mul (2^64-1)^2");
    expect(U128::mul(0x1'0000'0000ull, 0x1'0000'0000ull) == U128{1, 0}, "u128 mul 2^32^2");
    expect(U128::from_u64(5).mul_u64(3) == U128::from_u64(15), "u128 mul_u64 5*3");
    expect(U128::from_u64(100).div_u64(7) == 14, "u128 div floor 100/7");
    expect(compute_lp_share_price(1'000, 1'200) == U128::from_u64(1'200'000),
           "lp share price 1.2x");

    // Asset-engine premium + late-fee formulas.
    expect(compute_premium(1'000'000, 8, 0) == 800, "premium 8bps");
    expect(compute_premium(1'000'000, 30, 0) == 3'000, "premium 30bps");
    expect(compute_premium(1'000'000, 12, 0) == 1'200, "premium 12bps");
    expect(compute_premium(1'000, 12, 500) == 500, "premium min floor");
    expect(compute_late_fee(1'000'000'000, 0) == 0, "late fee zero blocks");
    expect(compute_late_fee(1'000'000'000, 200) == 100'000, "late fee 200 blocks");
    expect(compute_late_fee(1'000'000'000, 18'000) == 9'000'000, "late fee 18k blocks");

    // Capacity dynamic pricing.
    expect(compute_premium_bps(10, 200, 200, 0, BPS) == 10, "dyn premium idle");
    expect(compute_premium_bps(10, 500, 200, 5'000, BPS) == 110, "dyn premium half-load");
    expect(compute_premium_bps(10, 150, 200, BPS, BPS) == 150, "dyn premium cap");
    expect(compute_premium_bps(10, 500, 200, 5'000, 5'000) == 55, "dyn premium tier split");

    // 24h floating-window posture.
    const auto w = [] { return WINDOW_SLOTS; };
    const auto g = [] { return GRACE_SLOTS; };
    expect(window_posture(0, 5) == WindowPosture::NoWindow, "posture no window");
    expect(window_posture(1'000, 999) == WindowPosture::Open, "posture open (pre-1)");
    expect(window_posture(1'000, 1'000 + w() - 1) == WindowPosture::Open, "posture open (edge)");
    expect(window_posture(1'000, 1'000 + w()) == WindowPosture::Overdue, "posture overdue");
    expect(window_posture(1'000, 1'000 + w() + g() - 1) == WindowPosture::Overdue,
           "posture overdue (edge)");
    expect(window_posture(1'000, 1'000 + w() + g()) == WindowPosture::Breached,
           "posture breached");

    // ERC-4626 deposit/redeem ledger cross-checked with the on-chain formula.
    expect(compute_deposit_shares(1'000, 0, 0) == 1'000, "first deposit 1:1");
    expect(compute_lp_withdraw_value(1'000, 1'000, 1'200) == 1'200, "1.2x redeem");
    expect(compute_deposit_shares(600, 1'000, 1'200) == 500, "bob deposit @1.2");
    expect(compute_lp_withdraw_value(500, 1'500, 1'800) == 600, "bob redeem @1.2");
    expect(compute_lp_withdraw_value(1'000, 1'000, 0) == 0, "empty pool redeem");
    expect(compute_lp_withdraw_value(1'000, 1'000, 500) == 500, "redeem caps at assets");

    // MM ceiling admission contract.
    bool threw = false;
    try { assert_valid_mm_ceiling_usdc(0); } catch (const std::domain_error&) { threw = true; }
    expect(threw, "mm ceiling rejects zero");
    threw = false;
    try { assert_valid_mm_ceiling_usdc(MAX_MM_CEILING_USDC + 1); } catch (const std::domain_error&) { threw = true; }
    expect(threw, "mm ceiling rejects > C_desk");
    assert_valid_mm_ceiling_usdc(MAX_MM_CEILING_USDC);
    assert_valid_mm_ceiling_usdc(500'000'000'000ull);
    assert_valid_mm_ceiling_usdc(20'000'000'000ull);
    expect(true, "mm ceiling accepts in-range");

    // Standardized profiles carry distinct limits (mirror noviscia-types).
    expect(USDC_PROFILE.decimals == 6 && WSOL_PROFILE.decimals == 9 && NVSC_PROFILE.decimals == 9,
           "profile decimals");
    expect(USDC_PROFILE.base_premium_rate_bps < NVSC_PROFILE.base_premium_rate_bps,
           "profile premium ordering");
    expect(NVSC_PROFILE.max_capacity > USDC_PROFILE.max_capacity, "profile capacity ordering");
    // Numeric constants mirror noviscia-types / npm jitRisk.
    expect(LATE_FEE_RATE_BPS == 50 && LATE_FEE_BASE == 10'000, "late fee constants");
    expect(LP_PRICE_SCALE == 1'000'000 && WAD == 1'000'000'000'000ull,
           "LP price / WAD constants");
    expect(MM_STATUS_ACTIVE == 1 && MM_STATUS_SUSPENDED == 2, "mm status constants");
    expect(SLICE_RESERVED == 0 && SLICE_SETTLED == 1 && SLICE_DEFAULTED == 2 &&
               SLICE_REAPED == 3,
           "slice status constants");
    expect(MAX_MERKLE_DEPTH == 20, "max merkle depth 20");
}

}  // namespace

int main() {
    test_sha256_vectors();
    test_keccak256_vectors();
    test_base58_roundtrip();
    test_ed25519_on_curve();
    test_pda_derivations();
    test_pda_bumps();
    test_merkle_kyc();
    test_discriminators();
    test_instruction_builders();
    test_lp_pdas();
    test_discriminators_more();
    test_capacity_builders();
    test_asset_builders();
    test_compute_helpers();

    std::printf("%d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}