use serde::{Deserialize, Serialize};

/// All Noviscia event types the pipeline recognizes, parsed from on-chain
/// transaction log messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ParsedEvent {
    CreditPulled {
        borrower: String,
        amount: u64,
        outstanding: u64,
        slot: u64,
        tx_signature: String,
    },
    CreditSettled {
        borrower: String,
        principal: u64,
        toll: u64,
        rate_bps: u64,
        utilization_bps: u64,
        slot: u64,
        tx_signature: String,
    },
    LiquidityDeposited {
        pool: String,
        wallet: String,
        amount: u64,
        shares: u64,
        slot: u64,
        tx_signature: String,
    },
    LiquidityWithdrawn {
        pool: String,
        wallet: String,
        amount: u64,
        shares: u64,
        slot: u64,
        tx_signature: String,
    },
    SwapExecuted {
        pool: String,
        user: String,
        amount_in: u64,
        amount_out: u64,
        fee: u64,
        slot: u64,
        tx_signature: String,
    },
    PositionOpened {
        wallet: String,
        market: String,
        is_long: bool,
        size_usdc: u64,
        entry_price: u64,
        slot: u64,
        tx_signature: String,
    },
    PositionClosed {
        wallet: String,
        market: String,
        slot: u64,
        tx_signature: String,
    },
    Liquidated {
        wallet: String,
        market: String,
        slot: u64,
        tx_signature: String,
    },
    BidSubmitted {
        slot: u64,
        bidder: String,
        tip: u64,
        tx_signature: String,
    },
    AuctionSettled {
        slot: u64,
        winner: String,
        premium_tips: u64,
        tx_signature: String,
    },
}

impl ParsedEvent {
    /// Human-readable event type tag used in `EventEnvelope.event_type`.
    pub fn event_type_name(&self) -> &'static str {
        match self {
            Self::CreditPulled { .. } => "CreditPulled",
            Self::CreditSettled { .. } => "CreditSettled",
            Self::LiquidityDeposited { .. } => "LiquidityDeposited",
            Self::LiquidityWithdrawn { .. } => "LiquidityWithdrawn",
            Self::SwapExecuted { .. } => "SwapExecuted",
            Self::PositionOpened { .. } => "PositionOpened",
            Self::PositionClosed { .. } => "PositionClosed",
            Self::Liquidated { .. } => "Liquidated",
            Self::BidSubmitted { .. } => "BidSubmitted",
            Self::AuctionSettled { .. } => "AuctionSettled",
        }
    }

    /// The slot from which this event originated.
    pub fn slot(&self) -> u64 {
        match self {
            Self::CreditPulled { slot, .. }
            | Self::CreditSettled { slot, .. }
            | Self::LiquidityDeposited { slot, .. }
            | Self::LiquidityWithdrawn { slot, .. }
            | Self::SwapExecuted { slot, .. }
            | Self::PositionOpened { slot, .. }
            | Self::PositionClosed { slot, .. }
            | Self::Liquidated { slot, .. }
            | Self::BidSubmitted { slot, .. }
            | Self::AuctionSettled { slot, .. } => *slot,
        }
    }

    /// The transaction signature that produced this event.
    pub fn tx_signature(&self) -> &str {
        match self {
            Self::CreditPulled { tx_signature, .. }
            | Self::CreditSettled { tx_signature, .. }
            | Self::LiquidityDeposited { tx_signature, .. }
            | Self::LiquidityWithdrawn { tx_signature, .. }
            | Self::SwapExecuted { tx_signature, .. }
            | Self::PositionOpened { tx_signature, .. }
            | Self::PositionClosed { tx_signature, .. }
            | Self::Liquidated { tx_signature, .. }
            | Self::BidSubmitted { tx_signature, .. }
            | Self::AuctionSettled { tx_signature, .. } => tx_signature,
        }
    }

    /// Wallet addresses associated with this event (for filtering).
    pub fn wallets(&self) -> Vec<&str> {
        match self {
            Self::CreditPulled { borrower, .. } | Self::CreditSettled { borrower, .. } => {
                vec![borrower]
            }
            Self::LiquidityDeposited { wallet, .. }
            | Self::LiquidityWithdrawn { wallet, .. } => vec![wallet],
            Self::SwapExecuted { user, .. } => vec![user],
            Self::PositionOpened { wallet, .. }
            | Self::PositionClosed { wallet, .. }
            | Self::Liquidated { wallet, .. } => vec![wallet],
            Self::BidSubmitted { bidder, .. } => vec![bidder],
            Self::AuctionSettled { winner, .. } => vec![winner],
        }
    }
}

// ── Anchor Event Discriminators ──
//
// Anchor encodes events with an 8-byte SHA256 discriminator:
//   sha256("event:<EventName>")[..8]
//
// We pre-compute these for each Noviscia event type and match against
// the base58-encoded log line that Yellowstone emits.

/// Compute the 8-byte Anchor event discriminator for a given event name.
fn anchor_discriminator(event_name: &str) -> [u8; 8] {
    
    let mut hasher = Sha256Hasher::new();
    hasher.update(b"event:");
    hasher.update(event_name.as_bytes());
    let hash = hasher.finalize();
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash[..8]);
    disc
}

// ── Minimal SHA-256 ──
// We implement a compact SHA-256 to avoid adding a heavy crypto dependency.
// For a production deployment, swap this for the `sha2` crate.

struct Sha256Hasher {
    state: [u32; 8],
    buf: Vec<u8>,
    total_len: u64,
}

impl Sha256Hasher {
    fn new() -> Self {
        Self {
            state: [
                0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
            ],
            buf: Vec::new(),
            total_len: 0,
        }
    }

    fn update(&mut self, data: &[u8]) {
        self.buf.extend_from_slice(data);
        self.total_len += data.len() as u64;

        while self.buf.len() >= 64 {
            let block: [u8; 64] = self.buf[..64].try_into().unwrap();
            self.buf.drain(..64);
            self.process_block(&block);
        }
    }

    fn process_block(&mut self, block: &[u8; 64]) {
        let k: [u32; 64] = [
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
            0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
            0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
            0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
            0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
            0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
            0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
            0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
            0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
        ];

        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes(block[i * 4..(i + 1) * 4].try_into().unwrap());
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = h
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(k[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        self.state[0] = self.state[0].wrapping_add(a);
        self.state[1] = self.state[1].wrapping_add(b);
        self.state[2] = self.state[2].wrapping_add(c);
        self.state[3] = self.state[3].wrapping_add(d);
        self.state[4] = self.state[4].wrapping_add(e);
        self.state[5] = self.state[5].wrapping_add(f);
        self.state[6] = self.state[6].wrapping_add(g);
        self.state[7] = self.state[7].wrapping_add(h);
    }

    fn finalize(mut self) -> [u8; 32] {
        let bit_len = self.total_len * 8;
        self.buf.push(0x80);
        while (self.buf.len() % 64) != 56 {
            self.buf.push(0);
        }
        self.buf.extend_from_slice(&bit_len.to_be_bytes());

        // Process all complete 64-byte blocks.
        while self.buf.len() >= 64 {
            let block: [u8; 64] = self.buf[..64].try_into().unwrap();
            self.buf.drain(..64);
            self.process_block(&block);
        }

        let mut output = [0u8; 32];
        for (i, word) in self.state.iter().enumerate() {
            output[i * 4..(i + 1) * 4].copy_from_slice(&word.to_be_bytes());
        }
        output
    }
}

// ── Log Parsing ──

/// Known Anchor discriminator hex prefixes for each event type.
/// Format: first 8 bytes of sha256("event:<Name>"), hex-encoded (16 chars).
struct EventDiscriminators {
    credit_pulled: String,
    credit_settled: String,
    liquidity_deposited: String,
    liquidity_withdrawn: String,
    swap_executed: String,
    position_opened: String,
    position_closed: String,
    liquidated: String,
    bid_submitted: String,
    auction_settled: String,
}

fn event_discriminators() -> EventDiscriminators {
    let disc_hex = |name: &str| {
        let d = anchor_discriminator(name);
        hex_encode(&d)
    };
    EventDiscriminators {
        credit_pulled: disc_hex("CreditPulled"),
        credit_settled: disc_hex("CreditSettled"),
        liquidity_deposited: disc_hex("LiquidityDeposited"),
        liquidity_withdrawn: disc_hex("LiquidityWithdrawn"),
        swap_executed: disc_hex("SwapExecuted"),
        position_opened: disc_hex("PositionOpened"),
        position_closed: disc_hex("PositionClosed"),
        liquidated: disc_hex("Liquidated"),
        bid_submitted: disc_hex("BidSubmitted"),
        auction_settled: disc_hex("AuctionSettled"),
    }
}

/// Parse Solana transaction log messages and extract Noviscia-specific events.
///
/// Yellowstone emits log lines as strings like:
///   `Program data: <base64>`
///   `Program <program_id> invoke [1]`
///   `Program log: <message>`
///
/// Anchor events are emitted as `Program data:` lines containing
/// base64-encoded borsh with an 8-byte discriminator prefix.
pub fn parse_logs_for_events(
    logs: &[String],
    slot: u64,
    tx_signature: &str,
) -> Vec<ParsedEvent> {
    let discs = event_discriminators();
    let mut events = Vec::new();

    for log in logs {
        let trimmed = log.trim();

        // Match "Program data:" lines — these carry Anchor event payloads.
        let data_line = if let Some(rest) = trimmed.strip_prefix("Program data: ") {
            rest.trim()
        } else {
            continue;
        };

        // Decode base64 payload.
        let payload = match base64_decode(data_line) {
            Some(bytes) => bytes,
            None => continue,
        };

        // Need at least 8-byte discriminator + some data.
        if payload.len() < 8 {
            continue;
        }

        let disc_hex = hex_encode(&payload[..8]);

        // Match against known discriminators and parse borsh fields.
        if disc_hex == discs.credit_pulled {
            if let Some(ev) = parse_credit_pulled(&payload[8..], slot, tx_signature) {
                events.push(ev);
            }
        } else if disc_hex == discs.credit_settled {
            if let Some(ev) = parse_credit_settled(&payload[8..], slot, tx_signature) {
                events.push(ev);
            }
        } else if disc_hex == discs.liquidity_deposited {
            if let Some(ev) = parse_liquidity_deposited(&payload[8..], slot, tx_signature) {
                events.push(ev);
            }
        } else if disc_hex == discs.liquidity_withdrawn {
            if let Some(ev) = parse_liquidity_withdrawn(&payload[8..], slot, tx_signature) {
                events.push(ev);
            }
        } else if disc_hex == discs.swap_executed {
            if let Some(ev) = parse_swap_executed(&payload[8..], slot, tx_signature) {
                events.push(ev);
            }
        } else if disc_hex == discs.position_opened {
            if let Some(ev) = parse_position_opened(&payload[8..], slot, tx_signature) {
                events.push(ev);
            }
        } else if disc_hex == discs.position_closed {
            if let Some(ev) = parse_position_closed(&payload[8..], slot, tx_signature) {
                events.push(ev);
            }
        } else if disc_hex == discs.liquidated {
            if let Some(ev) = parse_liquidated(&payload[8..], slot, tx_signature) {
                events.push(ev);
            }
        } else if disc_hex == discs.bid_submitted {
            if let Some(ev) = parse_bid_submitted(&payload[8..], slot, tx_signature) {
                events.push(ev);
            }
        } else if disc_hex == discs.auction_settled {
            if let Some(ev) = parse_auction_settled(&payload[8..], slot, tx_signature) {
                events.push(ev);
            }
        }
    }

    events
}

// ── Borsh-style field parsers ──

fn read_pubkey(data: &[u8], offset: usize) -> Option<String> {
    if offset + 32 > data.len() {
        return None;
    }
    Some(bs58_encode_slice(&data[offset..offset + 32]))
}

fn read_u64(data: &[u8], offset: usize) -> Option<u64> {
    if offset + 8 > data.len() {
        return None;
    }
    Some(u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap()))
}

fn read_bool(data: &[u8], offset: usize) -> Option<bool> {
    if offset + 1 > data.len() {
        return None;
    }
    Some(data[offset] != 0)
}

fn parse_credit_pulled(data: &[u8], slot: u64, sig: &str) -> Option<ParsedEvent> {
    // CreditPulled { borrower: Pubkey, amount: u64, outstanding: u64 }
    let borrower = read_pubkey(data, 0)?;
    let amount = read_u64(data, 32)?;
    let outstanding = read_u64(data, 40)?;
    Some(ParsedEvent::CreditPulled {
        borrower,
        amount,
        outstanding,
        slot,
        tx_signature: sig.to_string(),
    })
}

fn parse_credit_settled(data: &[u8], slot: u64, sig: &str) -> Option<ParsedEvent> {
    // CreditSettled { borrower: Pubkey, principal: u64, toll: u64, rate_bps: u64, utilization_bps: u64 }
    let borrower = read_pubkey(data, 0)?;
    let principal = read_u64(data, 32)?;
    let toll = read_u64(data, 40)?;
    let rate_bps = read_u64(data, 48)?;
    let utilization_bps = read_u64(data, 56)?;
    Some(ParsedEvent::CreditSettled {
        borrower,
        principal,
        toll,
        rate_bps,
        utilization_bps,
        slot,
        tx_signature: sig.to_string(),
    })
}

fn parse_liquidity_deposited(data: &[u8], slot: u64, sig: &str) -> Option<ParsedEvent> {
    // LiquidityDeposited { pool: Pubkey, wallet: Pubkey, amount: u64, shares: u64 }
    let pool = read_pubkey(data, 0)?;
    let wallet = read_pubkey(data, 32)?;
    let amount = read_u64(data, 64)?;
    let shares = read_u64(data, 72)?;
    Some(ParsedEvent::LiquidityDeposited {
        pool,
        wallet,
        amount,
        shares,
        slot,
        tx_signature: sig.to_string(),
    })
}

fn parse_liquidity_withdrawn(data: &[u8], slot: u64, sig: &str) -> Option<ParsedEvent> {
    // LiquidityWithdrawn { pool: Pubkey, wallet: Pubkey, amount: u64, shares: u64 }
    let pool = read_pubkey(data, 0)?;
    let wallet = read_pubkey(data, 32)?;
    let amount = read_u64(data, 64)?;
    let shares = read_u64(data, 72)?;
    Some(ParsedEvent::LiquidityWithdrawn {
        pool,
        wallet,
        amount,
        shares,
        slot,
        tx_signature: sig.to_string(),
    })
}

fn parse_swap_executed(data: &[u8], slot: u64, sig: &str) -> Option<ParsedEvent> {
    // SwapExecuted { pool: Pubkey, user: Pubkey, amount_in: u64, amount_out: u64, fee: u64 }
    let pool = read_pubkey(data, 0)?;
    let user = read_pubkey(data, 32)?;
    let amount_in = read_u64(data, 64)?;
    let amount_out = read_u64(data, 72)?;
    let fee = read_u64(data, 80)?;
    Some(ParsedEvent::SwapExecuted {
        pool,
        user,
        amount_in,
        amount_out,
        fee,
        slot,
        tx_signature: sig.to_string(),
    })
}

fn parse_position_opened(data: &[u8], slot: u64, sig: &str) -> Option<ParsedEvent> {
    // Simplified: PositionOpened { wallet, market, is_long, size_usdc, entry_price }
    // The actual layout depends on the position-tracker's emit! fields.
    let wallet = read_pubkey(data, 0)?;
    let market = read_pubkey(data, 32)?;
    let is_long = read_bool(data, 64)?;
    let size_usdc = read_u64(data, 65)?;
    let entry_price = read_u64(data, 73)?;
    Some(ParsedEvent::PositionOpened {
        wallet,
        market,
        is_long,
        size_usdc,
        entry_price,
        slot,
        tx_signature: sig.to_string(),
    })
}

fn parse_position_closed(data: &[u8], slot: u64, sig: &str) -> Option<ParsedEvent> {
    // PositionClosed — wallet + market is sufficient.
    let wallet = read_pubkey(data, 0)?;
    let market = read_pubkey(data, 32)?;
    Some(ParsedEvent::PositionClosed {
        wallet,
        market,
        slot,
        tx_signature: sig.to_string(),
    })
}

fn parse_liquidated(data: &[u8], slot: u64, sig: &str) -> Option<ParsedEvent> {
    let wallet = read_pubkey(data, 0)?;
    let market = read_pubkey(data, 32)?;
    Some(ParsedEvent::Liquidated {
        wallet,
        market,
        slot,
        tx_signature: sig.to_string(),
    })
}

fn parse_bid_submitted(data: &[u8], _slot: u64, sig: &str) -> Option<ParsedEvent> {
    // BidAccepted { slot: u64, bidder: Pubkey, tip: u64 }
    let bid_slot = read_u64(data, 0)?;
    let bidder = read_pubkey(data, 8)?;
    let tip = read_u64(data, 40)?;
    Some(ParsedEvent::BidSubmitted {
        slot: bid_slot,
        bidder,
        tip,
        tx_signature: sig.to_string(),
    })
}

fn parse_auction_settled(data: &[u8], _slot: u64, sig: &str) -> Option<ParsedEvent> {
    // AuctionSettled { slot: u64, winner: Pubkey, premium_tips: u64 }
    let settled_slot = read_u64(data, 0)?;
    let winner = read_pubkey(data, 8)?;
    let premium_tips = read_u64(data, 40)?;
    Some(ParsedEvent::AuctionSettled {
        slot: settled_slot,
        winner,
        premium_tips,
        tx_signature: sig.to_string(),
    })
}

// ── Helpers ──

fn bs58_encode_slice(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if data.is_empty() {
        return String::new();
    }

    let mut leading_zeros = 0;
    for byte in data {
        if *byte == 0 {
            leading_zeros += 1;
        } else {
            break;
        }
    }

    let encoded_len = (data.len() * 138) / 100 + 1;
    let mut output = vec![0u8; encoded_len];
    let mut output_len = 0;

    for &byte in data {
        let mut carry = byte as u32;
        let mut j = 0;
        for k in 0..encoded_len {
            if j >= output_len && carry == 0 {
                break;
            }
            carry += output[k] as u32 * 256;
            output[k] = (carry % 58) as u8;
            carry /= 58;
            j += 1;
        }
        output_len = j;
    }

    let mut i = output_len;
    while i > 0 && output[i - 1] == 0 {
        i -= 1;
    }

    let mut result = String::with_capacity(leading_zeros + (output_len * 138) / 100 + 1);
    for _ in 0..leading_zeros {
        result.push('1');
    }
    while i > 0 {
        i -= 1;
        result.push(ALPHABET[output[i] as usize] as char);
    }
    result
}

/// Minimal base64 decoder (no-alloc, returns owned Vec).
fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const TABLE: [i8; 256] = {
        let mut t = [-1i8; 256];
        let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < 64 {
            t[chars[i] as usize] = i as i8;
            i += 1;
        }
        t
    };

    let input = input.trim_end_matches('=');
    if input.is_empty() {
        return Some(Vec::new());
    }

    let mut output = Vec::with_capacity(input.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0u32;

    for &byte in input.as_bytes() {
        let val = TABLE[byte as usize];
        if val < 0 {
            return None; // invalid character
        }
        buf = (buf << 6) | (val as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buf >> bits) as u8);
        }
    }

    Some(output)
}

/// Minimal hex encoding (no dependency).
fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_basic() {
        let mut hasher = Sha256Hasher::new();
        hasher.update(b"");
        let result = hasher.finalize();
        // SHA-256 of empty string.
        assert_eq!(
            hex_encode(&result),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn sha256_hello() {
        let mut hasher = Sha256Hasher::new();
        hasher.update(b"hello");
        let result = hasher.finalize();
        assert_eq!(
            hex_encode(&result),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn anchor_discriminator_is_first_8_bytes_of_sha256() {
        let d = anchor_discriminator("CreditPulled");
        let mut hasher = Sha256Hasher::new();
        hasher.update(b"event:CreditPulled");
        let full = hasher.finalize();
        assert_eq!(&d[..], &full[..8]);
    }

    #[test]
    fn base64_roundtrip() {
        let data = b"hello world";
        let encoded = base64_encode_simple(data);
        let decoded = base64_decode(&encoded).unwrap();
        assert_eq!(data.to_vec(), decoded);
    }

    fn base64_encode_simple(data: &[u8]) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut result = String::new();
        for chunk in data.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
            let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
            let triple = (b0 << 16) | (b1 << 8) | b2;
            result.push(ALPHABET[((triple >> 18) & 0x3F) as usize] as char);
            result.push(ALPHABET[((triple >> 12) & 0x3F) as usize] as char);
            if chunk.len() > 1 {
                result.push(ALPHABET[((triple >> 6) & 0x3F) as usize] as char);
            } else {
                result.push('=');
            }
            if chunk.len() > 2 {
                result.push(ALPHABET[(triple & 0x3F) as usize] as char);
            } else {
                result.push('=');
            }
        }
        result
    }

    #[test]
    fn hex_encode_basic() {
        assert_eq!(hex_encode(&[0xde, 0xad, 0xbe, 0xef]), "deadbeef");
    }
}
