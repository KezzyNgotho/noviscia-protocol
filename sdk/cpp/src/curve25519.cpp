#include "noviscia/curve25519.hpp"

#include <utility>

namespace noviscia {

namespace {

using Fe = std::array<std::uint64_t, 4>;  // little-endian 256-bit value in [0, p)

// p = 2^255 - 19 (little-endian 256-bit).
constexpr Fe P = {0xffffffffffffffedull, 0xffffffffffffffffull, 0xffffffffffffffffull,
                  0x7fffffffffffffffull};

constexpr bool fe_is_zero(const Fe& a) noexcept {
    return a[0] == 0 && a[1] == 0 && a[2] == 0 && a[3] == 0;
}

// Lexicographic compare (MSB-first).
int cmp256(const Fe& a, const Fe& b) noexcept {
    for (int i = 3; i >= 0; --i) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
    }
    return 0;
}

// a - p, assuming a >= p.
Fe fe_sub_p(const Fe& a) noexcept {
    Fe r;
    std::uint64_t borrow = 0;
    for (int i = 0; i < 4; ++i) {
        const __uint128_t sub = __uint128_t(P[i]) + borrow;
        const std::uint64_t s = std::uint64_t(sub);
        r[i] = a[i] - s;
        borrow = (a[i] < sub) ? 1 : 0;
    }
    return r;
}

// a + b mod p (inputs in [0, p), sum < 2p < 2^256).
Fe fe_add(const Fe& a, const Fe& b) noexcept {
    Fe r;
    std::uint64_t carry = 0;
    for (int i = 0; i < 4; ++i) {
        const __uint128_t s = __uint128_t(a[i]) + b[i] + carry;
        r[i] = std::uint64_t(s);
        carry = std::uint64_t(s >> 64);
    }
    return cmp256(r, P) >= 0 ? fe_sub_p(r) : r;
}

// p - a.
Fe fe_neg(const Fe& a) noexcept {
    Fe r;
    std::uint64_t borrow = 0;
    for (int i = 0; i < 4; ++i) {
        const __uint128_t sub = __uint128_t(a[i]) + borrow;
        const std::uint64_t s = std::uint64_t(sub);
        r[i] = P[i] - s;
        borrow = (P[i] < sub) ? 1 : 0;
    }
    return r;
}

// a - b mod p.
Fe fe_sub(const Fe& a, const Fe& b) noexcept {
    Fe d;
    std::uint64_t borrow = 0;
    for (int i = 0; i < 4; ++i) {
        const __uint128_t sub = __uint128_t(b[i]) + borrow;
        const std::uint64_t s = std::uint64_t(sub);
        d[i] = a[i] - s;
        borrow = (a[i] < sub) ? 1 : 0;
    }
    if (!borrow) return d;  // 0 <= a-b < p
    // a < b: result = a - b + p = (2^256 + a - b + p) mod 2^256.
    Fe r;
    std::uint64_t carry = 0;
    for (int i = 0; i < 4; ++i) {
        const __uint128_t s = __uint128_t(d[i]) + P[i] + carry;
        r[i] = std::uint64_t(s);
        carry = std::uint64_t(s >> 64);
    }
    // (a - b) + p in (0, p), so no further reduction needed.
    return r;
}

// a * b mod p. Full 256x256 product, fold by 2^256 ≡ 38 (mod p), then a
// bounded chain down to < p.
Fe fe_mul(const Fe& a, const Fe& b) noexcept {
    std::array<std::uint64_t, 8> t{};
    for (int i = 0; i < 4; ++i) {
        std::uint64_t carry = 0;
        for (int j = 0; j < 4; ++j) {
            const __uint128_t cur = __uint128_t(t[i + j]) + __uint128_t(a[i]) * b[j] + carry;
            t[i + j] = std::uint64_t(cur);
            carry = std::uint64_t(cur >> 64);
        }
        t[i + 4] = carry;
    }

    Fe r{};
    std::uint64_t carry = 0;
    constexpr std::uint64_t FOLD = 38;
    for (int i = 0; i < 4; ++i) {
        const __uint128_t s = __uint128_t(t[i]) + __uint128_t(t[i + 4]) * FOLD + carry;
        r[i] = std::uint64_t(s);
        carry = std::uint64_t(s >> 64);
    }
    // carry is tiny (< ~2^6); fold into the low limb, propagating any wrap.
    std::uint64_t fold = carry * FOLD;
    while (fold != 0) {
        const __uint128_t s = __uint128_t(r[0]) + fold;
        r[0] = std::uint64_t(s);
        fold = std::uint64_t(s >> 64);
        if (fold != 0) {
            // propagate carry up the lane.
            for (int i = 1; i < 4 && fold != 0; ++i) {
                const std::uint64_t n = r[i] + fold;
                r[i] = n;
                fold = (n < fold) ? 1 : 0;
            }
        }
    }
    int guard = 3;
    while (guard-- && cmp256(r, P) >= 0) {
        r = fe_sub_p(r);
    }
    return r;
}

Fe fe_sq(const Fe& a) noexcept { return fe_mul(a, a); }

// base^exponent mod p, MSB-first square-and-multiply.
Fe fe_pow(const Fe& base, const Fe& exponent) noexcept {
    Fe result = {1, 0, 0, 0};
    bool started = false;
    for (int bit = 255; bit >= 0; --bit) {
        const bool set = ((exponent[bit / 64] >> (bit % 64)) & 1u) != 0;
        if (started) {
            result = fe_sq(result);
            if (set) result = fe_mul(result, base);
        } else if (set) {
            result = base;
            started = true;
        }
    }
    return result;
}

struct CurveConst {
    Fe d;        // -121665/121666 mod p
    Fe sqrt_m1;  // 2^((p-1)/4), a square root of -1
};

CurveConst curve_constants() noexcept {
    // 121665 = 0x1DB41 ; 121666 = 0x1DB42
    const Fe c121665 = {0x000000000001db41ull, 0, 0, 0};
    const Fe c121666 = {0x000000000001db42ull, 0, 0, 0};
    const Fe pm2 = {0xffffffffffffffebull, 0xffffffffffffffffull, 0xffffffffffffffffull,
                    0x7fffffffffffffffull};  // p - 2 (Fermat exponent)
    const Fe inv121666 = fe_pow(c121666, pm2);
    const Fe d = fe_neg(fe_mul(c121665, inv121666));

    // sqrt(-1) = 2^((p-1)/4), exponent = 2^253 - 5.
    const Fe e = {0xfffffffffffffffbull, 0xffffffffffffffffull, 0xffffffffffffffffull,
                  0x1fffffffffffffffull};
    const Fe two = {2, 0, 0, 0};
    const Fe sqrt_m1 = fe_pow(two, e);
    return CurveConst{d, sqrt_m1};
}

// Exponent (p - 5)/8 = 2^252 - 3.
constexpr Fe E_P5_OVER_8 = {0xfffffffffffffffdull, 0xffffffffffffffffull, 0xffffffffffffffffull,
                            0x0fffffffffffffffull};

bool point_decompresses(std::span<const std::uint8_t, 32> bytes) noexcept {
    // y = low 255 bits (bit 255 is the x sign).
    Fe y{};
    for (int i = 0; i < 32; ++i) {
        const std::uint8_t b = (i == 31) ? (bytes[i] & 0x7fu) : bytes[i];
        y[i / 8] |= std::uint64_t(b) << ((i % 8) * 8);
    }
    if (cmp256(y, P) >= 0) return false;

    static const CurveConst c = curve_constants();

    const Fe one = {1, 0, 0, 0};
    const Fe y2 = fe_sq(y);
    const Fe u = fe_sub(y2, one);                  // y^2 - 1
    const Fe v = fe_add(fe_mul(c.d, y2), one);     // d*y^2 + 1
    if (fe_is_zero(v)) return false;

    // x = u * v^3 * (u * v^7)^((p-5)/8)
    const Fe v3 = fe_mul(fe_sq(v), v);
    const Fe v7 = fe_mul(fe_sq(v3), v);
    const Fe x0 = fe_mul(fe_mul(u, v3), fe_pow(fe_mul(u, v7), E_P5_OVER_8));

    // v*x^2 must equal u (else multiply by sqrt(-1): v*x^2 == -u).
    const Fe x1 = fe_mul(x0, c.sqrt_m1);
    const Fe check0 = fe_sub(fe_mul(v, fe_sq(x0)), u);
    if (!fe_is_zero(check0)) {
        if (!fe_is_zero(fe_sub(fe_mul(v, fe_sq(x1)), u))) return false;
    }
    return true;
}

}  // namespace

bool ed25519_is_on_curve(std::span<const std::uint8_t, 32> compressed) noexcept {
    return point_decompresses(compressed);
}

}  // namespace noviscia