#include "noviscia/pubkey.hpp"

#include "noviscia/curve25519.hpp"
#include "noviscia/hash.hpp"

#include <algorithm>
#include <cstdint>
#include <string_view>

namespace noviscia {

namespace {

constexpr char BASE58_ALPHABET[] = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
constexpr int BASE58_RADIX = 58;

}  // namespace

std::string base58_encode(std::span<const std::uint8_t> data) {
    int zeros = 0;
    while (zeros < static_cast<int>(data.size()) && data[zeros] == 0) ++zeros;

    std::vector<std::uint8_t> buf(data.begin() + zeros, data.end());
    std::string out;
    out.reserve(data.size() * 138 / 100 + 1);

    // Repeatedly divide the big-endian number by 58, collecting remainders.
    std::vector<std::uint8_t> digits;
    while (!buf.empty()) {
        unsigned rem = 0;
        bool top = false;
        std::vector<std::uint8_t> next;
        next.reserve(buf.size());
        for (std::uint8_t b : buf) {
            const unsigned cur = (rem << 8) | b;
            const unsigned q = cur / BASE58_RADIX;
            rem = cur % BASE58_RADIX;
            if (q != 0 || top) {
                next.push_back(static_cast<std::uint8_t>(q));
                top = true;
            }
        }
        digits.push_back(static_cast<std::uint8_t>(rem));
        buf = std::move(next);
    }
    for (int i = static_cast<int>(digits.size()) - 1; i >= 0; --i) {
        out.push_back(BASE58_ALPHABET[digits[static_cast<std::size_t>(i)]]);
    }
    out.insert(0, std::string(static_cast<std::size_t>(zeros), '1'));
    if (out.empty()) out = "1";
    return out;
}

bool base58_decode(std::string_view text, Pubkey& out) {
    if (text.empty()) return false;

    int zeros = 0;
    while (zeros < static_cast<int>(text.size()) && text[static_cast<std::size_t>(zeros)] == '1') {
        ++zeros;
    }
    if (zeros == static_cast<int>(text.size())) {
        // All leading '1's → the zero key.
        out = Pubkey{};
        if (zeros == static_cast<int>(text.size())) return true;
    }
    const int significant = static_cast<int>(text.size()) - zeros;

    // Accumulate base58 big-endian into a byte array sized to the result.
    std::vector<std::uint8_t> buf;
    const std::size_t cap = static_cast<std::size_t>(significant) * 733 / 1000 + 1;
    buf.reserve(cap);
    for (int k = zeros; k < static_cast<int>(text.size()); ++k) {
        const char ch = text[static_cast<std::size_t>(k)];
        int value = -1;
        for (int i = 0; i < BASE58_RADIX; ++i) {
            if (BASE58_ALPHABET[i] == ch) {
                value = i;
                break;
            }
        }
        if (value < 0) return false;
        // Multiply big-endian bignum in place by 58 and add value.
        unsigned carry = static_cast<unsigned>(value);
        for (auto it = buf.rbegin(); it != buf.rend(); ++it) {
            const unsigned cur = *it * BASE58_RADIX + carry;
            *it = static_cast<std::uint8_t>(cur & 0xffu);
            carry = cur >> 8;
        }
        while (carry) {
            buf.insert(buf.begin(), static_cast<std::uint8_t>(carry & 0xffu));
            carry >>= 8;
        }
    }

    if (buf.size() > PUBKEY_LEN) return false;
    Pubkey key{};
    const std::size_t pad = PUBKEY_LEN - buf.size();
    for (std::size_t i = 0; i < buf.size(); ++i) {
        key.bytes[pad + i] = buf[i];
    }
    out = key;
    return true;
}

std::optional<std::pair<Pubkey, std::uint8_t>> find_program_address(
    const Pubkey& program_id, std::span<const std::vector<std::uint8_t>> seeds) {
    // Modern PDA scheme (Solana runtime + web3.js): the bump rides as the last
    // seed, and the preimage is salted with the "ProgramDerivedAddress" tag:
    //   sha256(seeds[0] ‖ … ‖ seeds[n] ‖ [bump] ‖ program_id ‖ "ProgramDerivedAddress")
    constexpr std::string_view PDA_TAG = "ProgramDerivedAddress";
    std::vector<std::uint8_t> pre;
    for (const auto& s : seeds) pre.insert(pre.end(), s.begin(), s.end());
    const std::size_t bump_idx = pre.size();
    pre.push_back(0);  // bump placeholder (last seed)
    pre.insert(pre.end(), program_id.bytes.begin(), program_id.bytes.end());
    pre.insert(pre.end(), PDA_TAG.begin(), PDA_TAG.end());

    for (int bump = 255; bump >= 0; --bump) {
        pre[bump_idx] = static_cast<std::uint8_t>(bump);
        const auto h = sha256(pre);
        if (!ed25519_is_on_curve(h)) {
            Pubkey key{};
            std::copy(h.begin(), h.end(), key.bytes.begin());
            return std::pair{key, static_cast<std::uint8_t>(bump)};
        }
    }
    return std::nullopt;
}

}  // namespace noviscia