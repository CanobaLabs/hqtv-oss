import mongoose from "mongoose";
const Schema = mongoose.Schema;

const MediaSchema = new Schema({
  key: String,
  type: String,
  mediaId: String,
  contentType: String,
  hash: String,
  mediaUrl: String,
  mediaUrlPrivate: String,
  size: Number,
}, { _id: false });

const Outline = new Schema({
  gameId: {
    type: Number,
    required: true,
  },
  outline: [
    {
      // Universal
      itemType: String,
      id: Number,
      created: Date,
      createdBy: String,
      updated: Date,
      updatedBy: String,

      // question, puzzle
      lifeEligible: Boolean,
      
      // question
      question: String,
      questionLength: Number,
      answers: {
        type: [
          {
            id: Number,
            answer: String,
            correct: Boolean,
            erase: Boolean,
          },
        ],
        default: undefined,
      },
      media: {
        type: MediaSchema,
        default: undefined,
      },

      // checkpoint
      prizeCents: Number,
      prizePoints: Number,
      splitPrize: Boolean,
      splitPoints: Number,

      // wheel
      letters: { type: [String], default: undefined },

      // puzzle
      totalTimeMs: Number,
      hint: String,
      solution: String,
      initialRevealedLetters: { type: [String], default: [] },
      plannedReveals: {
        type: [
          {
            letter: String,
            time: Number,
          },
        ],
        default: undefined,
      },

      // survey
      survey: String,
      askDuration: Number,
      resultsDuration: Number,
      responses: {
        type: [
          {
            id: Number,
            response: String,
          },
        ],
        default: undefined,
      },

      // surveyResults
      forSurvey: Number,

      // note
      note: String,

      // giftDrop
      boxDuration: Number,
      items: {
        type: [
          {
            type: String,
            amount: Number,
            chance: Number,
          },
        ],
        default: undefined,
      },

      // results (nothing)
    },
  ],
});

export default Outline;
