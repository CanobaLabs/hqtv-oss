type RedisSeasonConfig = {
    seasonId: string;
    seasonName: string;
    startDate: string;
    endDate: string;
    tentpoleEnabled: string;
    tentpoleEnabled_android?: string;
    finalePrizeCents: string;
	howItWorks: string;
	disclaimer: string;
}

export default RedisSeasonConfig;
