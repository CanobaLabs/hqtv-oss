function constructIapProductsCallout(calloutType: 'extraLives' | 'erasers') {
	if (calloutType === 'extraLives') {
		return {
			type: "iapProductsCallout",
			titleText: "Buy Extra Lives",
			subtitleText: "Get some now to help you win!",
			products: [
				{
					productId: "com.intermedia.hq.item.extralife.1x",
					imageUrl: "https://cdn.canobal.com/hqtv/static/store/products/el-1.png",
					priceColor: "#3F4052",
					calloutText: null,
					calloutColor: null,
					badge: null
				},
				{
					productId: "com.intermedia.hq.item.extralife.3x",
					imageUrl: "https://cdn.canobal.com/hqtv/static/store/products/el-3.png",
					priceColor: "#3F4052",
					calloutText: null,
					calloutColor: null,
					badge: null
				},
				{
					productId: "com.intermedia.hq.item.extralife.5x",
					imageUrl: "https://cdn.canobal.com/hqtv/static/store/products/el-5.png",
					priceColor: "#3F4052",
					calloutText: null,
					calloutColor: null,
					badge: null
				}
			],
			items: [
				{
					itemId: "com.intermedia.hq.item.extralife.1x",
					imageUrl: "https://cdn.canobal.com/hqtv/static/store/products/el-1.png",
					priceColor: "#3F4052",
					calloutText: null,
					calloutColor: null,
					badge: null
				},
				{
					itemId: "com.intermedia.hq.item.extralife.3x",
					imageUrl: "https://cdn.canobal.com/hqtv/static/store/products/el-3.png",
					priceColor: "#3F4052",
					calloutText: null,
					calloutColor: null,
					badge: null
				},
				{
					itemId: "com.intermedia.hq.item.extralife.5x",
					imageUrl: "https://cdn.canobal.com/hqtv/static/store/products/el-5.png",
					priceColor: "#3F4052",
					calloutText: null,
					calloutColor: null,
					badge: null
				}
			],
			delayWindowMs: 0,
			durationMs: 15000
		};
	} else {
		return {
			type: "iapProductsCallout",
			titleText: "Buy Erasers",
			subtitleText: "Get some now to help you win!",
			products: [
				{
					productId: "com.intermedia.hq.item.erasers.1x",
					imageUrl: "https://cdn.canobal.com/hqtv/static/store/products/eraser-1.png",
					priceColor: "#3F4052",
					calloutText: null,
					calloutColor: null,
					badge: null
				},
				{
					productId: "com.intermedia.hq.item.erasers.3x",
					imageUrl: "https://cdn.canobal.com/hqtv/static/store/products/eraser-3.png",
					priceColor: "#3F4052",
					calloutText: null,
					calloutColor: null,
					badge: null
				},
				{
					productId: "com.intermedia.hq.item.erasers.5x",
					imageUrl: "https://cdn.canobal.com/hqtv/static/store/products/eraser-5.png",
					priceColor: "#3F4052",
					calloutText: null,
					calloutColor: null,
					badge: null
				}
			],
			items: [
				{
					itemId: "com.intermedia.hq.item.erasers.1x",
					imageUrl: "https://cdn.canobal.com/hqtv/static/store/products/eraser-1.png",
					priceColor: "#3F4052",
					calloutText: null,
					calloutColor: null,
					badge: null
				},
				{
					itemId: "com.intermedia.hq.item.erasers.3x",
					imageUrl: "https://cdn.canobal.com/hqtv/static/store/products/eraser-3.png",
					priceColor: "#3F4052",
					calloutText: null,
					calloutColor: null,
					badge: null
				},
				{
					itemId: "com.intermedia.hq.item.erasers.5x",
					imageUrl: "https://cdn.canobal.com/hqtv/static/store/products/eraser-5.png",
					priceColor: "#3F4052",
					calloutText: null,
					calloutColor: null,
					badge: null
				}
			],
			delayWindowMs: 0,
			durationMs: 15000
		};
	}
}

export default constructIapProductsCallout;
