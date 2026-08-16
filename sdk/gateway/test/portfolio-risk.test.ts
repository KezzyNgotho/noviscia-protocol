import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sandbox } from '../src/index';
import { PortfolioEngine } from '../src/portfolio';

test('portfolio risk engine recognizes netted cross-market exposure', () => {
  const sandbox = new Sandbox('risk-check');
  const engine = new PortfolioEngine(sandbox);

  engine.addPosition({
    id: 'sol-long',
    market: 'SOL',
    notionalUsdc: 20000,
    side: 'long',
    entryPrice: 160,
    collateralUsdc: 4000,
    maintenanceMarginBps: 1000,
  });

  engine.addPosition({
    id: 'sol-short',
    market: 'SOL',
    notionalUsdc: 15000,
    side: 'short',
    entryPrice: 155,
    collateralUsdc: 3000,
    maintenanceMarginBps: 1000,
  });

  const risk = engine.computePortfolioRisk({
    marketCorrelations: {
      SOL: { SOL: 1 },
    },
  });

  assert.ok(risk.totalExposureUsdc > 0, 'portfolio exposure must be positive');
  assert.ok(risk.nettingBenefitUsdc >= 0, 'netting should not worsen margin requirement');
  assert.ok(risk.totalRequiredMargin > 0, 'required margin should be computed');
  assert.ok(risk.marginShortfall >= 0, 'shortfall should never be negative');
});
