import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SandboxSimulator } from './sandbox';

describe('SandboxSimulator', () => {
  describe('market management', () => {
    it('stores and retrieves market data', () => {
      const sim = new SandboxSimulator();
      sim.setMarket('SOL', { price: 150, fundingIndex: 0, maxLeverageBps: 500000, maintenanceMarginBps: 199 });
      const m = sim.getMarket('SOL');
      assert.ok(m);
      assert.equal(m.price, 150);
      assert.equal(m.maintenanceMarginBps, 199);
    });

    it('returns undefined for unknown market', () => {
      const sim = new SandboxSimulator();
      assert.equal(sim.getMarket('DOGE'), undefined);
    });
  });

  describe('position management', () => {
    it('adds and retrieves positions', () => {
      const sim = new SandboxSimulator();
      const pos = { owner: 'alice', market: 'SOL', isLong: true, sizeUsdc: 10_000_000, entryPrice: 150, collateralShares: 5_000_000, maintenanceMarginBps: 199 };
      sim.addPosition(pos);
      assert.equal(sim.getPositions().length, 1);
      assert.equal(sim.getPositions()[0].owner, 'alice');
    });

    it('getPositions returns a copy', () => {
      const sim = new SandboxSimulator();
      sim.addPosition({ owner: 'a', market: 'SOL', isLong: true, sizeUsdc: 1, entryPrice: 1, collateralShares: 1, maintenanceMarginBps: 199 });
      const positions = sim.getPositions();
      positions.pop();
      assert.equal(sim.getPositions().length, 1);
    });

    it('clearPositions empties the list', () => {
      const sim = new SandboxSimulator();
      sim.addPosition({ owner: 'a', market: 'SOL', isLong: true, sizeUsdc: 1, entryPrice: 1, collateralShares: 1, maintenanceMarginBps: 199 });
      sim.clearPositions();
      assert.equal(sim.getPositions().length, 0);
    });
  });

  describe('computePnl', () => {
    it('computes positive PnL for a long', () => {
      const sim = new SandboxSimulator();
      const pos = { owner: 'a', market: 'SOL', isLong: true, sizeUsdc: 1000, entryPrice: 100, collateralShares: 100, maintenanceMarginBps: 199 };
      const pnl = sim.computePnl(pos, 110);
      // (110 - 100) * 1 * (1000 / 100) = 100
      assert.equal(pnl, 100);
    });

    it('computes negative PnL for a long', () => {
      const sim = new SandboxSimulator();
      const pos = { owner: 'a', market: 'SOL', isLong: true, sizeUsdc: 1000, entryPrice: 100, collateralShares: 100, maintenanceMarginBps: 199 };
      const pnl = sim.computePnl(pos, 90);
      // (90 - 100) * 1 * (1000 / 100) = -100
      assert.equal(pnl, -100);
    });

    it('computes positive PnL for a short', () => {
      const sim = new SandboxSimulator();
      const pos = { owner: 'a', market: 'SOL', isLong: false, sizeUsdc: 1000, entryPrice: 100, collateralShares: 100, maintenanceMarginBps: 199 };
      const pnl = sim.computePnl(pos, 90);
      // (90 - 100) * -1 * (1000 / 100) = 100
      assert.equal(pnl, 100);
    });

    it('returns 0 for zero/negative reference price', () => {
      const sim = new SandboxSimulator();
      const pos = { owner: 'a', market: 'SOL', isLong: true, sizeUsdc: 1000, entryPrice: 100, collateralShares: 100, maintenanceMarginBps: 199 };
      assert.equal(sim.computePnl(pos, 0), 0);
      assert.equal(sim.computePnl(pos, -10), 0);
    });
  });

  describe('computeLiveMargin', () => {
    it('adds collateral + PnL', () => {
      const sim = new SandboxSimulator();
      const pos = { owner: 'a', market: 'SOL', isLong: true, sizeUsdc: 1000, entryPrice: 100, collateralShares: 500, maintenanceMarginBps: 199 };
      const margin = sim.computeLiveMargin(pos, 110);
      // collateral 500 + PnL 100 = 600
      assert.equal(margin, 600);
    });
  });

  describe('computeRequiredMargin', () => {
    it('size * bps / 10000', () => {
      const sim = new SandboxSimulator();
      const pos = { owner: 'a', market: 'SOL', isLong: true, sizeUsdc: 10000, entryPrice: 1, collateralShares: 1, maintenanceMarginBps: 200 };
      assert.equal(sim.computeRequiredMargin(pos), 200);
    });
  });

  describe('checkPositionHealth', () => {
    it('healthy when margin >= required', () => {
      const sim = new SandboxSimulator();
      const pos = { owner: 'a', market: 'SOL', isLong: true, sizeUsdc: 1000, entryPrice: 100, collateralShares: 200, maintenanceMarginBps: 199 };
      const result = sim.checkPositionHealth(pos, 100);
      // live margin: 200 + 0 = 200, required: 1000 * 199 / 10000 = 19.9
      assert.equal(result.ok, true);
      assert.equal(result.shortfall, 0);
    });

    it('unhealthy when margin < required', () => {
      const sim = new SandboxSimulator();
      const pos = { owner: 'a', market: 'SOL', isLong: true, sizeUsdc: 10000, entryPrice: 100, collateralShares: 50, maintenanceMarginBps: 199 };
      const result = sim.checkPositionHealth(pos, 90);
      // live margin: 50 + (-1000) = -950, required: 10000 * 199 / 10000 = 199
      assert.equal(result.ok, false);
      assert.ok(result.shortfall > 0);
    });
  });

  describe('simulateFill', () => {
    it('creates a position with the given params', () => {
      const sim = new SandboxSimulator();
      const pos = sim.simulateFill('SOL', true, 5000, 150, 2500, 199);
      assert.equal(pos.market, 'SOL');
      assert.equal(pos.isLong, true);
      assert.equal(pos.sizeUsdc, 5000);
      assert.equal(pos.entryPrice, 150);
      assert.equal(pos.collateralShares, 2500);
      assert.equal(pos.maintenanceMarginBps, 199);
      assert.equal(pos.owner, 'simulated');
    });
  });
});
