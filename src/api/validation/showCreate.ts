import { Joi } from "express-validation";

module.exports = {
    body: Joi.object({
        showType: Joi.string().required(),
        gameType: Joi.string().required(),
        vertical: Joi.string().required(),
        gameKey: Joi.string().required(),
        title: Joi.string().required(),
        summary: Joi.string().required(),
        accentColor: Joi.string().required(),
        description: Joi.string().required(),
        logoUrl: Joi.string().required(),
        bgImageUrl: Joi.string().required(),
        bgVideoUrl: Joi.string().required(),
        alwaysVisible: Joi.boolean().required(),
        defaultOpt: Joi.string().optional(),
        order: Joi.number().optional()
    })
};
