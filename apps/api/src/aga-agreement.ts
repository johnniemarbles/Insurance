// The AGA agreement supplied by Punjab Insurance (Contract - AGA). The words are theirs.
// Marks in {{double braces}} are filled from the broker's file when the agreement is sent.
// {{advisor_name}} and the date marks are filled when the agent signs. Nothing here is a second signature for the company.

export const AGA_TITLE = 'AGA Agreement';
export const AGA_VERSION = 'aga-1';

const BLANK = '____________________';

/** Replaces {{marks}} that have a value. A mark with no value is left as written. */
export function fillAgreement(body: string, values: Record<string, string | null | undefined>): string {
  return body.replace(/\{\{([a-z0-9_]+)\}\}/g, (all, key: string) => {
    const v = values[key];
    return typeof v === 'string' && v.trim() ? v.trim() : all;
  });
}

/** Calendar date in Toronto, which is where the company signs. */
export function signDateParts(at: Date): { sign_day: string; sign_month: string; sign_year: string; effective_date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  const sign_day = get('day');
  const sign_month = get('month');
  const sign_year = get('year');
  return { sign_day, sign_month, sign_year, effective_date: `${sign_day} ${sign_month} ${sign_year}` };
}

export const blank = BLANK;

export const AGA_BODY = `AGA AGREEMENT

BETWEEN:

PUNJAB INSURANCE INC.
(hereinafter called THE COMPANY)

AND

{{aga_name}}
(hereinafter called the AGA)

1. RELATIONSHIP WITH COMPANY: It is hereby agreed that this document between The Company and the AGA is effective from {{effective_date}}

2. GOAL: As agreed upon this date, the Company retains the AGA as a licensed producer who solicits, writes, sells and services insurance policies for their own clients through The Company as their Associate General Agency, (hereinafter called the AGA). This AGA Agreement is to operate in conjunction with the Agent Agreement between the AGA and each of the Life Insurance Companies for which the AGA is contracted.

3. DESIGNATION: The Company hereby appoints the AGA as an independent contractor to solicit applications personally and to submit such applications to The Company for submission to the Life Insurance Companies. This agreement does not create any employer-employee relationship between the AGA and The Company.

4. TRANSFER FEES: In the event that the AGA is transferring a contract from another MGA, The Life Insurance Company processing the transfer request may require payment of a transfer fee to set up a new AGA code under The Company. In the event that this is required, it is the sole responsibility of the AGA to pay the fee directly to The Life Insurance Company unless otherwise negotiated with the Company.

5. EXISTING CLIENTELE: When an AGA wants to transfer a contract from one MGA to another MGA, the block of business that was solicited through the previous MGA usually remains with that MGA. It is possible, however, that The Life Insurance Company in question will want the new MGA to purchase the existing block of business from the previous MGA prior to processing the transfer request. In the event that this is required, on behalf of the AGA, The Company will have to negotiate with the MGA the feasibility of this purchase and will provide in writing to the AGA the outcome of said negotiation. Until such notification is received, the Agent/ Broker is not to assume that the new MGA will purchase the block of business or that the transfer will be processed. In the event that the purchase is approved, the AGA will be expected to pay any fees to The Life Insurance Company required to complete the transfer unless payment from the MGA is negotiated beforehand.

6. RESPONSIBILITIES: The AGA is responsible to maintain his/her license as a Life Insurance Agent under the applicable provincial law and must hold a valid Errors & Omission Insurance certificate, (hereinafter called E&O). The AGA is responsible for providing copies of these documents to The Company, initially upon acceptance of this agreement and annually upon renewal thereafter, to ensure that The Company is in compliance with industry requirements. In turn, The Company is responsible to maintain the corporate life license and corporate E&O certificate and provide copies of both to the Managing General Agent, (hereinafter Called the MGA), initially upon acceptance of the agreement and annually upon renewal thereafter.

7. COMPLIANCE: The AGA will follow the rules of The Company, comply with The Code of Conduct, (attached to this agreement as Schedule A), and comply with the Privacy Guidelines, (attached to the agreement as Schedule B). The AGA will also comply with the rules of the Life Insurance Companies and will abide by all applicable provincial and federal statutes and regulations. The AGA will not make, alter or discharge any contract, accept risks of any kind, revive policies or intentionally incur any debts.

8. ADVERTISING: The AGA will not, in the name of The Company and/or in the name of the Life Insurance Companies, publish, distribute, circulate or broadcast advertisements or promotional material without prior written authorization from The Company and/or Life Insurance Companies.

9. AGREEMENT: The AGA will be responsible to complete individual contracting with The Life Insurance Companies as an independent contractor operating through The Company. This contracting is required to be completed with each Life Insurance Company prior to placing the first piece of business and will be coordinated by The Company through the MGA.

10. COMPENSATION: First Year Commission, (hereinafter called FYC), production bonus and any renewal commissions will be paid directly to each AGA from the Life Insurance Companies when, and if, possible. In the event that this is not possible. The Company will pay the AGA the total combined FYC, production bones and renewal commission paid to The Company on behalf of the AGA by the end of the month following the credit of funds from The Life Insurance Company. In addition to payment of all commission earned, a detailed statement of the amount payable will be provided to the AGA.

11. COMMISSIONS: FYC and production bonuses are annualized, (except where otherwise indicated), and constitute an advance against unearned commissions and production bonuses. This advance of commissions and production bonuses is subject to charge back in accordance with the Lapse and Surrender Guidelines of the Life Insurance Companies.

12. RETURN OF FUNDS:

If AGA and its agents becomes indebted to Company, or any of the Insurers through Company, in connection with any policy or plan submitted by AGA or its Broker through Company and AGA for which AGA or its brokers received compensation hereunder or under Broker's contract with an Insurer, hereby agrees to repay such Indebtedness on demand (the "Debt").

ii. If the Debt is not repaid by AGA or its brokers within 60 days of the date on which notice is given to AGA or its broker by Company, or the Insurer of the Debt, Company may offset against any claim for compensation hereunder or against any other money payable to AGA by Company, any Insurer, any Debt due or to become due from AGA to Company, whether arising under this Agreement or otherwise, which Debt will be a first charge against such compensation. In connection herewith, AGA hereby authorizes Company to (A) direct any Insurers with which both Company and AGA deal, to assign and make payable to Company all future compensation earned by AGA (including, without limitation, commission, override, bonus, renewal and service commission) from such Insurers, and (B) apply any proceeds received from Insurers under (A) hereof, to the reduction of the Debt, until such time as the Debt is reduced to nil. Any such assignment will cease upon repayment in full of the Debt owing to Company.

iii. If any Debt is not repaid within said 60 days, or if a mutually acceptable arrangement has not been made regarding repayment, Company may refer the Debt to a collection agent. The cost of such action, including, without limitation, collection agency, legal and accounting fees and interest, will be recoverable from AGA as part of the Debt.

13. VESTING: This agreement hereby confirms that the AGA shall be fully vested with regards to renewals. This agreement also confirms that on termination of this agreement, the ownership of the business written by the AGA through The Company will remain exclusively with the AGA.

14. PERSONAL GUARANTEE: The AGA personally guarantees repayment of all debts and shall be liable for advanced but unearned commissions and production bonuses and charge backs. This guarantee shall apply to all policies written for the Life Insurance Companies solicited by the AGA and placed through The Company. The AGA unconditionally guarantees The Company to pay all unearned commissions and bonuses and commission charge backs upon demand. This guarantee is binding on the heirs and personal representatives of the AGA.

This guarantee shall survive the termination of this agreement or any agreement between the Agent/ Broker and The Company.

15. ASSIGNMENT: For value received, the AGA hereby assigns to The Company all amounts of any nature or kind whatsoever owing, accruing, or which may hereafter become owing or accruing to the AGA from the Life Insurance Companies, (hereinafter referred to as the debts), to be continuing security to The Company.

16. DISCHARGE OF CONTRACT: This agreement will terminate immediately and automatically should:
a) The AGA not renew his/her life insurance license as required by the provincial licensing agent.
b) Any provincial licensing authority refuses to renew the AGA life insurance license
c) The AGA not comply with E&O requirements
d) There be any implication of fraud, insolvency, bankruptcy or gross and willful misconduct on the part of the AGA or The Company
e) Either party provides written notice to the other party requesting termination.

DATED AT {{city}}, {{province}}, THIS {{sign_day}} DAY OF {{sign_month}}, {{sign_year}}

ADVISOR NAME: {{advisor_name}}

SIGNING OFFICER (CORPORATION): {{officer_name}}
NAME OF CORPORATION: {{corporation_name}}

NAME & TITLE OF OFFICER: {{officer_name}}

AUTHORIZED OFFICER
PUNJAB INSURANCE INC.`;
