//
//  WatchTWeatherDraw.swift
//  watch Extension
//
//  Created by KwangHo Kim on 2017. 11. 6..
//

import WatchKit
import WatchConnectivity
import Foundation

//let watchTWUtil = WatchTWeatherUtil();

class WatchTWeatherDraw : WKInterfaceController{
    
    //    @IBOutlet var updateDateLabel: WKInterfaceLabel!
    //    @IBOutlet var currentPosImage: WKInterfaceImage!
    //    @IBOutlet var addressLabel: WKInterfaceLabel!
    //    @IBOutlet var curWeatherImage: WKInterfaceImage!
    //
    //    @IBOutlet var curTempLabel: WKInterfaceLabel!
    //    @IBOutlet var minMaxLabel: WKInterfaceLabel!
    //
    //    @IBOutlet var precLabel: WKInterfaceLabel!
    //    @IBOutlet var airAQILabel: WKInterfaceLabel!
    
    var curJsonDict : Dictionary<String, Any>? = nil;
    
    // Singleton
    
    static let sharedInstance : WatchTWeatherDraw = {
        let instance = WatchTWeatherDraw()
        //setup code
        return instance
    }()
    
    #if false
    struct StaticInstance {
    static var instance: WatchTWeatherDraw?
    }
    
    class func sharedInstance() -> WatchTWeatherDraw {
    if !(StaticInstance.instance != nil) {
    StaticInstance.instance = WatchTWeatherDraw()
    }
    return StaticInstance.instance!
    }
    #endif
    
    //    let watchTWUtil = WatchTWeatherUtil.sharedInstance();
    //    let watchTWReq = WatchTWeatherRequest.sharedInstance();
    //   let watchTWSM = WatchTWeatherShowMore.sharedInstance();
    
    #if false
    func processWeatherResultsWithShowMore( jsonDict : Dictionary<String, AnyObject>?) {
    
    
    
    //var currentDict : Dictionary<String, Any>;
    //var currentArpltnDict : Dictionary<String, Any>;
    var todayDict : Dictionary<String, Any>;
    
    // Date
    var strDateTime : String!;
    //var strTime : String? = nil;
    
    // Image
    //var strCurIcon : String? = nil;
    var strCurImgName : String? = nil;
    
    // Temperature
    var currentTemp : Float = 0;
    var todayMinTemp : Int = 0;
    var todayMaxTemp : Int = 0;
    
    // Dust
    var strAirState : String = "";
    var attrStrAirState : NSAttributedString = NSAttributedString();
    //NSMutableAttributedString   *nsmasAirState = nil;
    
    // Address
    var strAddress : String? = nil;
    
    // Pop
    var numberTodPop : NSNumber;
    var todayPop : Int = 0;
    
    // current temperature
    var numberT1h : NSNumber;
    var numberTaMin : NSNumber;
    var numberTaMax : NSNumber;
    
    if(jsonDict == nil)
    {
    print("jsonDict is nil!!!");
    return;
    }
    //print("processWeatherResultsWithShowMore : \(String(describing: jsonDict))");
    
    setCurJsonDict( dict : jsonDict! ) ;
    
    // Address
    if let strRegionName : String = jsonDict?["regionName"] as? String {
    print("strRegionName is \(strRegionName).")
    strAddress = strRegionName;
    } else {
    print("That strRegionName is not in the jsonDict dictionary.")
    }
    
    if let strCityName : String = jsonDict?["cityName"] as? String {
    print("strCityName is \(strCityName).")
    strAddress = strCityName;
    } else {
    print("That strCityName is not in the jsonDict dictionary.")
    }
    
    if let strTownName : String = jsonDict?["townName"] as? String {
    print("strTownName is \(strTownName).")
    strAddress = strTownName;
    } else {
    print("That strTownName is not in the jsonDict dictionary.")
    }
    
    // if address is current position... add this emoji
    //목격자
    //유니코드: U+1F441 U+200D U+1F5E8, UTF-8: F0 9F 91 81 E2 80 8D F0 9F 97 A8
    
    print("strAddress \(String(describing: strAddress)))")
    strAddress = NSString(format: "👁‍🗨%@˚", strAddress!) as String
    
    let tempUnit : TEMP_UNIT? = watchTWUtil.getTemperatureUnit();
    //#if KKH
    // Current
    if let currentDict : Dictionary<String, Any> = jsonDict?["current"] as? Dictionary<String, Any>{
    //print("currentDict is \(currentDict).")
    
    if let strCurIcon : String = currentDict["skyIcon"] as? String {
    //strCurImgName = "weatherIcon2-color/\(strCurIcon).png";
    strCurImgName = strCurIcon;
    } else {
    print("That strCurIcon  is not in the jsonDict dictionary.")
    }
    
    if let strTime : String = currentDict["time"] as? String {
    let index = strTime.index(strTime.startIndex, offsetBy: 2)
    //let strHour = strTime.substring(to:index);
    let strHour = strTime[..<index];
    //let strMinute = strTime.substring(from:index);
    let strMinute = strTime[index...];
    strDateTime         = NSLocalizedString("LOC_UPDATE",        comment:"업데이트") + " " + strHour + ":" + strMinute;
    
    print("strTime => \(strTime)")
    print("strHour => \(strHour)")
    print("strMinute => \(strMinute)")
    
    } else {
    print("That strTime  is not in the jsonDict dictionary.")
    strDateTime         = "";
    }
    print("strDateTime => \(strDateTime)")
    
    if let currentArpltnDict : Dictionary<String, Any> = currentDict["arpltn"] as? Dictionary<String, Any> {
    strAirState         = watchTWSM.getAirState(currentArpltnDict);
    
    // Test
    //nssAirState = [NSString stringWithFormat:@"통합대기 78 나쁨"];
    attrStrAirState       = watchTWSM.getChangedColorAirState(strAirState:strAirState);
    print("[processWeatherResultsWithShowMore] attrStrAirState : \(String(describing: attrStrAirState))");
    print("[processWeatherResultsWithShowMore] strAirState : \(String(describing: strAirState))");
    } else {
    print("That currentArpltnDict  is not in the jsonDict dictionary.")
    }
    
    if (currentDict["t1h"] != nil)
    {
    numberT1h = currentDict["t1h"] as! NSNumber;
    currentTemp = Float(numberT1h.doubleValue);
    
    if(tempUnit == TEMP_UNIT.FAHRENHEIT) {
    currentTemp     = Float(watchTWUtil.convertFromCelsToFahr(cels: currentTemp));
    }
    }
    
    } else {
    print("That currentDict  is not in the jsonDict dictionary.")
    }
    
    //currentHum         = [[currentDict valueForKey:@"reh"] intValue];
    
    todayDict = watchTWUtil.getTodayDictionary(jsonDict: jsonDict!);
    
    // Today
    if (todayDict["taMin"] != nil) {
    numberTaMin = todayDict["taMin"] as! NSNumber;
    todayMinTemp    = Int(numberTaMin.intValue);
    } else {
    print("That idTaMin  is not in the todayDict dictionary.")
    }
    
    if(tempUnit ==  TEMP_UNIT.FAHRENHEIT)
    {
    todayMinTemp     = Int( watchTWUtil.convertFromCelsToFahr(cels: Float(todayMinTemp) ) );
    }
    
    if (todayDict["taMax"] != nil) {
    numberTaMax = todayDict["taMax"] as! NSNumber;
    todayMaxTemp    = Int(numberTaMax.intValue);
    } else {
    print("That numberTaMax  is not in the todayDict dictionary.")
    }
    
    if(tempUnit == TEMP_UNIT.FAHRENHEIT)
    {
    todayMaxTemp     = Int(watchTWUtil.convertFromCelsToFahr(cels: Float(todayMaxTemp) )) ;
    }
    
    if (todayDict["pop"] != nil) {
    numberTodPop = todayDict["pop"] as! NSNumber;
    todayPop    = Int(numberTodPop.intValue);
    } else {
    print("That pop  is not in the todayDict dictionary.")
    }
    
    print("todayMinTemp: \(todayMinTemp), todayMaxTemp:\(todayMaxTemp)");
    print("todayPop: \(todayPop)");
    
    DispatchQueue.global(qos: .background).async {
    // Background Thread
    
    DispatchQueue.main.async {
    
    // Run UI Updates
    if(strDateTime != nil) {
    self.updateDateLabel.setText("\(strDateTime!)");
    }
    
    print("=======>  date : \(strDateTime!)");
    
    if( (strAddress == nil) || ( strAddress == "(null)" ))
    {
    self.addressLabel.setText("");
    }
    else
    {
    self.addressLabel.setText("\(strAddress!)");
    }
    
    print("=======>  strCurImgName : \(strCurImgName!)");
    
    if(strCurImgName != nil) {
    self.curWeatherImage.setImage ( UIImage(named:strCurImgName!) );
    }
    
    if(tempUnit == TEMP_UNIT.FAHRENHEIT) {
    self.curTempLabel.setText( NSString(format: "%d˚", currentTemp) as String );
    } else {
    self.curTempLabel.setText( NSString(format: "%.01f˚", currentTemp) as String);
    }
    
    
    print("[processWeatherResultsWithShowMore] attrStrAirState2 : \(String(describing: attrStrAirState))");
    self.airAQILabel.setAttributedText( attrStrAirState );
    
    self.minMaxLabel.setText(NSString(format: "%d˚/ %d˚", todayMinTemp, todayMaxTemp) as String );
    self.precLabel.setText(NSString(format: "%d%%", todayPop) as String );
    
    
    
    //locationView.hidden = false;
    }
    }
    //#endif
    
    // Draw ShowMore
    //[todayWSM           processDailyData:jsonDict type:TYPE_REQUEST_WEATHER_KR];
    }
    
    func processWeatherResultsAboutGlobal( jsonDict : Dictionary<String, AnyObject>?) {
    let watchTWSM = WatchTWeatherShowMore();
    
    var currentDict : Dictionary<String, Any>;
    //var currentArpltnDict : Dictionary<String, Any>;
    var todayDict : Dictionary<String, Any>? = nil;
    
    // Date
    var strDateTime : String!;
    //var strTime : String? = nil;
    
    // Image
    //var strCurIcon : String? = nil;
    var strCurImgName : String? = nil;
    
    // Temperature
    var tempUnit : TEMP_UNIT? = TEMP_UNIT.CELSIUS;
    var currentTemp : Float = 0;
    var todayMinTemp : Int = 0;
    var todayMaxTemp : Int = 0;
    
    // Dust
    var strAirState : String = "";
    var attrStrAirState : NSAttributedString = NSAttributedString();
    //NSMutableAttributedString   *nsmasAirState = nil;
    
    // Address
    var strAddress : String? = nil;
    
    // Pop
    var numberTodPop : NSNumber;
    var todayPop : Int = 0;
    
    // Humid
    var numberTodHumid : NSNumber;
    var todayHumid = 0;
    
    if(jsonDict == nil)
    {
    print("jsonDict is nil!!!");
    return;
    }
    //print("processWeatherResultsWithShowMore : \(String(describing: jsonDict))");
    
    setCurJsonDict( dict : jsonDict! ) ;
    
    // Address
    
    //NSLog(@"mCurrentCityIdx : %d", mCurrentCityIdx);
    
    //NSMutableDictionary* nsdCurCity = [mCityDictList objectAtIndex:mCurrentCityIdx];
    //NSLog(@"[processWeatherResultsAboutGlobal] nsdCurCity : %@", nsdCurCity);
    // Address
    //nssAddress = [nsdCurCity objectForKey:@"name"];
    //nssCountry = [nsdCurCity objectForKey:@"country"];
    //if(nssCountry == nil)
    //{
    //  nssCountry = @"KR";
    //}
    
    //NSLog(@"[Global]nssAddress : %@, nssCountry : %@", nssAddress, nssCountry);
    
    // if address is current position... add this emoji
    //목격자
    //유니코드: U+1F441 U+200D U+1F5E8, UTF-8: F0 9F 91 81 E2 80 8D F0 9F 97 A8
    
    //print("strAddress \(String(describing: strAddress)))")
    //strAddress = NSString(format: "👁‍🗨%@˚", strAddress!) as String
    
    strAddress = NSString(format: "뉴욕") as String;
    
    // Current
    if let thisTimeArr : NSArray = jsonDict?["thisTime"] as? NSArray {
    
    if(thisTimeArr.count == 2) {
    currentDict         = thisTimeArr[1] as! Dictionary<String, Any>;        // Use second index; That is current weahter.
    } else {
    currentDict         = thisTimeArr[0] as! Dictionary<String, Any>;        // process about thisTime
    }
    
    if let strCurIcon : String = currentDict["skyIcon"] as? String {
    //strCurImgName = "weatherIcon2-color/\(strCurIcon).png";
    strCurImgName = strCurIcon;
    } else {
    print("That strCurIcon  is not in the jsonDict dictionary.")
    }
    
    tempUnit = watchTWUtil.getTemperatureUnit();
    
    if let strTime : String = currentDict["date"] as? String {
    let index = strTime.index(strTime.startIndex, offsetBy: 11)
    let strHourMin = strTime[index...];
    strDateTime         = NSLocalizedString("LOC_UPDATE",        comment:"업데이트") + " " + strHourMin;
    print("strTime => \(strHourMin)")
    
    todayDict = watchTWUtil.getTodayDictionaryInGlobal(jsonDict: jsonDict!, strTime:strTime);
    if(todayDict != nil) {
    if(tempUnit == TEMP_UNIT.FAHRENHEIT)
    {
    let idTaMin    = todayDict!["tempMin_f"] as! NSNumber;
    todayMinTemp    = Int(truncating: idTaMin);
    
    let idTaMax    = todayDict!["tempMax_f"] as! NSNumber;
    todayMaxTemp    = Int(truncating: idTaMax);
    }
    else
    {
    let idTaMin    = todayDict!["tempMin_c"] as! NSNumber;
    todayMinTemp    = Int(truncating: idTaMin);
    
    let idTaMax    = todayDict!["tempMax_c"] as! NSNumber;
    todayMaxTemp    = Int(truncating: idTaMax);
    }
    
    // PROBABILITY_OF_PRECIPITATION
    if (todayDict!["precProb"] != nil) {
    numberTodPop = todayDict!["precProb"] as! NSNumber;
    todayPop    = Int(numberTodPop.intValue);
    } else {
    print("That precProb  is not in the todayDict dictionary.")
    }
    
    // HUMID
    if (todayDict!["humid"] != nil) {
    numberTodHumid = todayDict!["humid"] as! NSNumber;
    todayHumid    = Int(numberTodHumid.intValue);
    } else {
    print("That humid  is not in the todayDict dictionary.")
    }
    
    strAirState = NSLocalizedString("LOC_HUMIDITY", comment:"습도") + " \(todayHumid)% ";
    }
    } else {
    print("That strTime  is not in the jsonDict dictionary.")
    let strHourMin         = "";
    strDateTime         = NSLocalizedString("LOC_UPDATE",        comment:"업데이트") + " " + strHourMin;
    }
    print("strDateTime => \(strDateTime)")
    
    if(tempUnit == TEMP_UNIT.FAHRENHEIT)
    {
    let idT1h    = currentDict["temp_f"] as! NSNumber;
    currentTemp     = Float(Int(truncating: idT1h));
    }
    else
    {
    let idT1h    = currentDict["temp_c"] as! NSNumber;
    currentTemp     = Float(truncating: idT1h);
    }
    }
    
    print("todayMinTemp: \(todayMinTemp), todayMaxTemp:\(todayMaxTemp)");
    print("todayPop: \(todayPop)");
    
    #if KKH
    if let currentDict : Dictionary<String, Any> = jsonDict?["current"] as? Dictionary<String, Any>{
    //print("currentDict is \(currentDict).")
    
    if let currentArpltnDict : Dictionary<String, Any> = currentDict["arpltn"] as? Dictionary<String, Any> {
    strAirState         = watchTWSM.getAirState(currentArpltnDict);
    
    // Test
    //nssAirState = [NSString stringWithFormat:@"통합대기 78 나쁨"];
    attrStrAirState       = watchTWSM.getChangedColorAirState(strAirState:strAirState);
    print("[processWeatherResultsWithShowMore] attrStrAirState : \(String(describing: attrStrAirState))");
    print("[processWeatherResultsWithShowMore] strAirState : \(String(describing: strAirState))");
    } else {
    print("That currentArpltnDict  is not in the jsonDict dictionary.")
    }
    } else {
    print("That currentDict  is not in the jsonDict dictionary.")
    }
    #endif
    
    DispatchQueue.global(qos: .background).async {
    // Background Thread
    
    DispatchQueue.main.async {
    
    // Run UI Updates
    if(strDateTime != nil) {
    self.updateDateLabel.setText("\(strDateTime!)");
    }
    
    print("=======>  date : \(strDateTime!)");
    
    if( (strAddress == nil) || ( strAddress == "(null)" ))
    {
    self.addressLabel.setText("");
    }
    else
    {
    self.addressLabel.setText("\(strAddress!)");
    }
    
    print("=======>  strCurImgName : \(strCurImgName!)");
    strCurImgName = "MoonBigCloudRainLightning";
    if(strCurImgName != nil) {
    self.curWeatherImage.setImage ( UIImage(named:"Moon"/*strCurImgName!*/) );
    print("111=======>  strCurImgName : \(strCurImgName!)");
    }
    
    if(tempUnit == TEMP_UNIT.FAHRENHEIT) {
    self.curTempLabel.setText( NSString(format: "%d˚", currentTemp) as String );
    } else {
    self.curTempLabel.setText( NSString(format: "%.01f˚", currentTemp) as String);
    }
    
    
    #if KKH
    print("[processWeatherResultsWithShowMore] attrStrAirState2 : \(String(describing: attrStrAirState))");
    self.airAQILabel.setAttributedText( attrStrAirState );
    #endif
    
    self.minMaxLabel.setText(NSString(format: "%d˚/ %d˚", todayMinTemp, todayMaxTemp) as String );
    self.precLabel.setText(NSString(format: "%d%%", todayPop) as String );
    self.airAQILabel.setText(strAirState);
    
    //locationView.hidden = false;
    }
    }
    //#endif
    
    // Draw ShowMore
    //[todayWSM           processDailyData:jsonDict type:TYPE_REQUEST_WEATHER_KR];
    }
    #endif
    
    func setCurJsonDict( dict : Dictionary<String, Any> ) {
        if(curJsonDict == nil) {
            curJsonDict = [String : String] ()
        } else {
            curJsonDict = dict;
        }
    }
    
}

