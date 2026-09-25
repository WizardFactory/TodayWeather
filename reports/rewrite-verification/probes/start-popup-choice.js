new Promise(function(resolve){
  var i=angular.element(document).injector(), W=i.get('WeatherInfo'), $state=i.get('$state'), root=i.get('$rootScope');
  var out={};
  function cur(){return {state:$state.current.name, currentPosDisabled:W.getCityOfIndex(0)&&W.getCityOfIndex(0).currentPosition?W.getCityOfIndex(0).disable:'n/a'};}
  function run(value, label, next){
    root.$apply(function(){ $state.go('tab.forecast'); });
    setTimeout(function(){
      root.$apply(function(){ W.disableCity(true); });
      var tab=null; Array.from(document.querySelectorAll('*')).some(function(e){var s=angular.element(e).scope(); if(s&&s.startPopup&&s.showRetryConfirm){tab=s;return true}});
      out[label]={before:cur()};
      tab.startPopup();
      setTimeout(function(){
        var radios=Array.from(document.querySelectorAll('.popup ion-radio, .popup .item-radio'));
        out[label].radioLabels=radios.map(function(r){return r.innerText.trim()});
        tab.$apply(function(){tab.data.autoSearch=value;});
        document.querySelector('.popup .button-positive').click();
        setTimeout(function(){ out[label].after=cur(); next(); },1500);
      },800);
    },1200);
  }
  run(true,'value_true',function(){ run(false,'value_false',function(){ resolve(out); }); });
})
