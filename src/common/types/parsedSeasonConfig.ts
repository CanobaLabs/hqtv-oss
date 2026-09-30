import LevelInfo from './level';

type ParsedSeasonConfig = {
    seasonId: string;
    seasonName: string;
    startDate: Date;
    endDate: Date;
    tentpoleEnabled: boolean;
    tentpoleEnabled_android?: string;
    finalePrizeCents: number;
	howItWorks: string;
	disclaimer: string;
    levels: LevelInfo[];
}

export default ParsedSeasonConfig;
