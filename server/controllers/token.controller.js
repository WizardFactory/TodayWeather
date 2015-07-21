/**
 * Created by Peter on 2015. 7. 19..
 */

/*
* using example
{
 var body = {
 name: 'seojungsu',
 id: 'pokers'
 };
 var secret = 'abcdefghi';
 var token = new mgrToken(body, secret);
 console.log(token.encryption().enc);
 console.log(token.decryption(token.encryption().enc).dec);
}
*/
var jwt = require('jwt-simple');

function jwtToken(body, secret) {
    this.body = body;
    this.secret = secret;
    return this;
}

jwtToken.prototype.encryption = function(){
    this.enc = jwt.encode(this.body, this.secret);
    return this;
};

jwtToken.prototype.decryption = function(token){
    this.dec = jwt.decode(token, this.secret);
    return this;
};

module.exports = jwtToken;