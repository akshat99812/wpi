/**
 * Newton-Raphson IRR calculation
 */
export function calculateIRR(cashFlows: number[], guess: number = 0.1): number | null {
  const maxIterations = 100;
  const precision = 1e-7;
  let irr = guess;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dNpv = 0;

    for (let j = 0; j < cashFlows.length; j++) {
      npv += cashFlows[j] / Math.pow(1 + irr, j);
      dNpv -= (j * cashFlows[j]) / Math.pow(1 + irr, j + 1);
    }

    if (Math.abs(npv) < precision) {
      return irr * 100;
    }

    const nextIrr = irr - npv / dNpv;
    if (isNaN(nextIrr) || !isFinite(nextIrr)) return null;
    
    irr = nextIrr;
  }

  return irr * 100;
}

export function calculateNPV(cashFlows: number[], rate: number): number {
  return cashFlows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + rate, i), 0);
}
