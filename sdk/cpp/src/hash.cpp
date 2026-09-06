#include "noviscia/hash.hpp"

namespace noviscia {

namespace {

// ── SHA-256 internals ──────────────────────────────────────────────────────

constexpr std::array<std::uint32_t, 64> SHA256_K{
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu,
    0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u, 0xd807aa98u, 0x12835b01u,
    0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u,
    0xc19bf174u, 0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
    0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau, 0x983e5152u,
    0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u,
    0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu,
    0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u,
    0xd6990624u, 0xf40e3585u, 0x106aa070u, 0x19a4c116u, 0x1e376c08u,
    0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu,
    0x682e6ff3u, 0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
};

constexpr std::array<std::uint32_t, 8> SHA256_H0{
    0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
    0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u,
};

inline std::uint32_t rotr32(std::uint32_t x, unsigned n) noexcept {
    return (x >> n) | (x << (32u - n));
}

void sha256_compress(std::array<std::uint32_t, 8>& h,
                     std::span<const std::uint8_t, 64> block) noexcept {
    std::array<std::uint32_t, 64> w{};
    for (std::size_t i = 0; i < 16; ++i) {
        w[i] = (std::uint32_t(block[i * 4]) << 24) | (std::uint32_t(block[i * 4 + 1]) << 16) |
               (std::uint32_t(block[i * 4 + 2]) << 8) | std::uint32_t(block[i * 4 + 3]);
    }
    for (std::size_t i = 16; i < 64; ++i) {
        const auto s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >> 3);
        const auto s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    auto a = h[0], b = h[1], c = h[2], d = h[3];
    auto e = h[4], f = h[5], g = h[6], hh = h[7];
    for (std::size_t i = 0; i < 64; ++i) {
        const auto S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
        const auto ch = (e & f) ^ (~e & g);
        const auto t1 = hh + S1 + ch + SHA256_K[i] + w[i];
        const auto S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
        const auto maj = (a & b) ^ (a & c) ^ (b & c);
        const auto t2 = S0 + maj;
        hh = g;
        g = f;
        f = e;
        e = d + t1;
        d = c;
        c = b;
        b = a;
        a = t1 + t2;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
}

// ── Keccak-f[1600] internals ───────────────────────────────────────────────

inline std::uint64_t rol64(std::uint64_t x, unsigned n) noexcept {
    return (x << n) | (x >> (64u - n));
}

constexpr std::array<std::uint64_t, 24> KECCAK_RC{
    0x0000000000000001ull, 0x0000000000008082ull, 0x800000000000808aull,
    0x8000000080008000ull, 0x000000000000808bull, 0x0000000080000001ull,
    0x8000000080008081ull, 0x8000000000008009ull, 0x000000000000008aull,
    0x0000000000000088ull, 0x0000000080008009ull, 0x000000008000000aull,
    0x000000008000808bull, 0x800000000000008bull, 0x8000000000008089ull,
    0x8000000000008003ull, 0x8000000000008002ull, 0x8000000000000080ull,
    0x000000000000800aull, 0x800000008000000aull, 0x8000000080008081ull,
    0x8000000000008080ull, 0x0000000080000001ull, 0x8000000080008008ull,
};

// Rotation offsets r[x][y], flattened at index i = x + 5*y.
constexpr std::array<unsigned, 25> KECCAK_ROT{
    0u, 1u, 62u, 28u, 27u, 36u, 44u, 6u, 55u, 20u,
    3u, 10u, 43u, 25u, 39u, 41u, 45u, 15u, 21u, 8u,
    18u, 2u, 61u, 56u, 14u,
};

// Keccak-p[1600,24] shown as the sponge permutation over 25 lanes.
void keccak_f1600(std::array<std::uint64_t, 25>& st) noexcept {
    for (std::uint64_t rc : KECCAK_RC) {
        // Theta
        std::array<std::uint64_t, 5> c{};
        for (unsigned x = 0; x < 5; ++x) {
            c[x] = st[x] ^ st[x + 5] ^ st[x + 10] ^ st[x + 15] ^ st[x + 20];
        }
        for (unsigned x = 0; x < 5; ++x) {
            const auto d = c[(x + 4) % 5] ^ rol64(c[(x + 1) % 5], 1);
            for (unsigned y = 0; y < 5; ++y) st[x + 5 * y] ^= d;
        }
        // Rho + Pi
        std::array<std::uint64_t, 25> b{};
        for (unsigned x = 0; x < 5; ++x) {
            for (unsigned y = 0; y < 5; ++y) {
                const auto i = x + 5 * y;
                const auto dest = y + 5 * ((2 * x + 3 * y) % 5);
                b[dest] = rol64(st[i], KECCAK_ROT[i] == 0u ? 0u : KECCAK_ROT[i]);
            }
        }
        // Chi
        for (unsigned y = 0; y < 5; ++y) {
            for (unsigned x = 0; x < 5; ++x) {
                st[x + 5 * y] = b[x + 5 * y] ^ ((~b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y]);
            }
        }
        // Iota
        st[0] ^= rc;
    }
}

constexpr std::size_t KECCAK_RATE = 136;  // bytes for Keccak-256

inline void keccak_absorb_byte(std::array<std::uint64_t, 25>& st, std::size_t offset,
                               std::uint8_t byte) noexcept {
    st[offset >> 3] ^= std::uint64_t(byte) << (8ull * (offset & 7u));
}

}  // namespace

std::array<std::uint8_t, SHA256_DIGEST_LEN> sha256(std::span<const std::uint8_t> data) noexcept {
    std::array<std::uint32_t, 8> h = SHA256_H0;
    const std::size_t total = data.size();
    const std::size_t full = total & ~std::size_t{63};

    std::size_t i = 0;
    for (; i < full; i += 64) {
        sha256_compress(h, data.subspan(i).first<64>());
    }

    std::array<std::uint8_t, 64> tail{};
    const auto rem = total - full;
    for (std::size_t j = 0; j < rem; ++j) tail[j] = data[full + j];
    tail[rem] = 0x80u;
    if (rem >= 56) {
        sha256_compress(h, tail);
        tail.fill(0);
    }
    const auto bits = total * 8ull;
    for (std::size_t j = 0; j < 8; ++j) {
        tail[63 - j] = std::uint8_t(bits >> (8ull * j));
    }
    sha256_compress(h, tail);

    std::array<std::uint8_t, 32> out{};
    for (std::size_t j = 0; j < 8; ++j) {
        out[j * 4] = std::uint8_t(h[j] >> 24);
        out[j * 4 + 1] = std::uint8_t(h[j] >> 16);
        out[j * 4 + 2] = std::uint8_t(h[j] >> 8);
        out[j * 4 + 3] = std::uint8_t(h[j]);
    }
    return out;
}

std::array<std::uint8_t, KECCAK256_DIGEST_LEN> keccak256(std::span<const std::uint8_t> data) noexcept {
    std::array<std::uint64_t, 25> st{};

    const std::size_t full = (data.size() / KECCAK_RATE) * KECCAK_RATE;
    for (std::size_t i = 0; i < full; i += KECCAK_RATE) {
        for (std::size_t j = 0; j < KECCAK_RATE; ++j) {
            keccak_absorb_byte(st, j, data[i + j]);
        }
        keccak_f1600(st);
    }

    // Final block with original-Keccak padding: 0x01 ... 0x80.
    const auto rem = data.size() - full;
    for (std::size_t j = 0; j < rem; ++j) {
        keccak_absorb_byte(st, j, data[full + j]);
    }
    keccak_absorb_byte(st, rem, 0x01u);
    keccak_absorb_byte(st, KECCAK_RATE - 1, 0x80u);
    keccak_f1600(st);

    // Squeeze: first 32 bytes little-endian (4 lanes).
    std::array<std::uint8_t, 32> out{};
    for (std::size_t i = 0; i < 4; ++i) {
        for (std::size_t j = 0; j < 8; ++j) {
            out[i * 8 + j] = std::uint8_t(st[i] >> (8ull * j));
        }
    }
    return out;
}

}  // namespace noviscia