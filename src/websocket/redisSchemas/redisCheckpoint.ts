type RedisCheckpoint = {
    checkpointId: string;
    questionNumber: string;
    prizeTotalCents?: string;
    prizeTotalPoints?: string;
    splitPrize?: string;
    splitPoints?: string;
    offerStarted?: string;
    prizeOfferCents?: string;
    prizeOfferPoints?: string;
    eligiblePlayersCount?: string;
    winners?: string;
}

export default RedisCheckpoint;
