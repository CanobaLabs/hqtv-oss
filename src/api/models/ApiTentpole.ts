import centsToDollars from '../../common/utils/centsToDollars';

class ApiTentpole {
    displayName: string;
    accentColor: string;
    backgroundColor: string;
    backgroundImage: string;
    backgroundVideo: string;
    textColor: string;
    howItWorks: string;
    finePrint: string;
    prizeCents: number;
    prizeCurrency: string;
    prizeStr: string;
    name: string;
    time: string;
    active: boolean;
    state: string;
    constructor(seasonName: string, seasonDisplayName: string, bgImg: string, bgVid: string, prizeCents: number, endDate: string, howItWorks: string, disclaimer: string) {
        this.displayName = seasonDisplayName;
        this.accentColor = '#FDD444';
        this.backgroundColor = '#E42E6E';
        this.backgroundImage = bgImg;
        this.backgroundVideo = bgVid;
        this.textColor = '#FFFFFF';
        this.howItWorks = howItWorks;
        this.finePrint = disclaimer;
        this.prizeCents = prizeCents;
        this.prizeCurrency = 'USD';
        this.prizeStr = prizeCents == 0 ? '' : centsToDollars(prizeCents);
        this.name = seasonName;
        this.time = endDate;
        this.active = true;
        this.state = 'active';
    }
}

export default ApiTentpole;
