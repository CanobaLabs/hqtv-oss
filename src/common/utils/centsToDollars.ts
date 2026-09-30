function centsToDollars(cents: number | undefined) {
    if (cents == null) {
        cents = 0;
    }
    const dollars = cents / 100;
    const dollarsStr = dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const dollarsAbbrev = dollarsStr.replace('.00', ''); // don't display zero cents ($5.00 --> $5)
    return dollarsAbbrev;
}

export default centsToDollars;
