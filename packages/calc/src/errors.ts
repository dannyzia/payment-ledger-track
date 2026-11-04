export class InvalidCalcInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCalcInputError';
  }
}

export class DeductionsExceedGrossError extends Error {
  public readonly grossPoisha: bigint;
  public readonly totalDeductionsPoisha: bigint;
  public readonly vatPoisha: bigint;
  public readonly commissionPoisha: bigint;
  public readonly businessChargePoisha: bigint;

  constructor(
    grossPoisha: bigint,
    vatPoisha: bigint,
    commissionPoisha: bigint,
    businessChargePoisha: bigint,
  ) {
    const totalDeductionsPoisha = vatPoisha + commissionPoisha + businessChargePoisha;
    super(
      `Total deductions (${totalDeductionsPoisha.toString()} poisha: vat=${vatPoisha.toString()}, commission=${commissionPoisha.toString()}, businessCharge=${businessChargePoisha.toString()}) exceed gross amount (${grossPoisha.toString()} poisha)`,
    );
    this.name = 'DeductionsExceedGrossError';
    this.grossPoisha = grossPoisha;
    this.totalDeductionsPoisha = totalDeductionsPoisha;
    this.vatPoisha = vatPoisha;
    this.commissionPoisha = commissionPoisha;
    this.businessChargePoisha = businessChargePoisha;
  }
}
