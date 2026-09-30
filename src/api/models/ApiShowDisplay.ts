class ApiShowDisplay {
    title: string;
    summary: string;
    accentColor: string;
    description: string;
    image: string;
    logo: string;
    bgImage: string;
    bgVideo: string;
    subtitle?: string;
    constructor(title: string, summary: string, accentColour: string, description: string, logoUrl: string, bgImage: string, bgVideo: string, subtitle?: string) {
        this.title = title;
        this.summary = summary;
        this.accentColor = accentColour;
        this.description = description;
        this.image = logoUrl;
        this.logo = logoUrl;
        this.bgImage = bgImage;
        this.bgVideo = bgVideo;
        this.subtitle = subtitle;
    }
}

export default ApiShowDisplay;
