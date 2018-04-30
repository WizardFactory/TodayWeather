/**
 * Created by Peter on 2017. 10. 18..
 */
var mongoose = require('mongoose');

var townMidSeaSchema = mongoose.Schema({
    regId: String,
    pubDate: Date, //last data.date+data.time
    fcsDate: Date,
    data: {
        date: String,
        time: String,
        regId: String,
        wf3Am: String,
        wf3Pm: String,
        wf4Am: String,
        wf4Pm: String,
        wf5Am: String,
        wf5Pm: String,
        wf6Am: String,
        wf6Pm: String,
        wf7Am: String,
        wf7Pm: String,
        wf8: String,
        wf9: String,
        wf10: String,
        wh3AAm: {type : Number, default : -100},
        wh3APm: {type : Number, default : -100},
        wh3BAm: {type : Number, default : -100},
        wh3BPm: {type : Number, default : -100},
        wh4AAm: {type : Number, default : -100},
        wh4APm: {type : Number, default : -100},
        wh4BAm: {type : Number, default : -100},
        wh4BPm: {type : Number, default : -100},
        wh5AAm: {type : Number, default : -100},
        wh5APm: {type : Number, default : -100},
        wh5BAm: {type : Number, default : -100},
        wh5BPm: {type : Number, default : -100},
        wh6AAm: {type : Number, default : -100},
        wh6APm: {type : Number, default : -100},
        wh6BAm: {type : Number, default : -100},
        wh6BPm: {type : Number, default : -100},
        wh7AAm: {type : Number, default : -100},
        wh7APm: {type : Number, default : -100},
        wh7BAm: {type : Number, default : -100},
        wh7BPm: {type : Number, default : -100},
        wh8A: {type : Number, default : -100},
        wh8B: {type : Number, default : -100},
        wh9A: {type : Number, default : -100},
        wh9B: {type : Number, default : -100},
        wh10A: {type : Number, default : -100},
        wh10B: {type : Number, default : -100}
    }
});

townMidSeaSchema.index({regId: "hashed"});
townMidSeaSchema.index({regId: 1, pubDate: 1});
townMidSeaSchema.index({regId: 1, fcsDate: 1});

module.exports = mongoose.model('kma.town.mid.sea', townMidSeaSchema);
