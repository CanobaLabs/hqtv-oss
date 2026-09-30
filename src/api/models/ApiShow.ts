import Show from '../../common/database/configModels/show';
import ApiShowDisplay from './ApiShowDisplay';
import ApiShowLive from './ApiShowLive';

class ApiShow {
    showType: string;
    showId: number;
    gameType: string;
    vertical: string;
    opt: string;
    startTime?: Date;
    display: ApiShowDisplay;
    media: string[];
    currency: string;
    prizeCents?: number;
    prizePoints?: number;
    live: ApiShowLive | undefined;
    constructor(gameId: number, show: Show, display: ApiShowDisplay, media: string[] = [], startTime?: Date, prizeCents?: number, prizePoints?: number, live?: ApiShowLive) {
        this.showType = show.showType;
        this.showId = gameId;
        this.gameType = show.gameType;
        this.vertical = show.vertical;
        this.opt = show.defaultOpt;
        this.startTime = startTime;
        this.display = display;
        this.media = media;
        this.currency = 'USD';
        this.prizeCents = prizeCents;
        this.prizePoints = prizePoints;
        this.live = live;
    }
}

export default ApiShow;
