import centsToDollars from '../../common/utils/centsToDollars';

function formatNumber(num: number): string {
    if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}k`;
    }
    return num.toString();
}

function generatePrizeDisplayText(prizeCents: number, prizePoints: number) {
    if (prizeCents > 0 && prizePoints > 0) {
        return `${centsToDollars(prizeCents)} + ${formatNumber(prizePoints)} pts`;
    } else if (prizeCents === 0 && prizePoints > 0) {
        return `${formatNumber(prizePoints)} pts`;
    } else if (prizeCents > 0) {
        return centsToDollars(prizeCents);
    } else {
        return centsToDollars(0);
    }
}

export default generatePrizeDisplayText;
