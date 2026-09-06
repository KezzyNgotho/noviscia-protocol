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

    std::printf("%d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}