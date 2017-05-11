package net.wizardfactory.todayweather.widget.Data;

import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Created by aleckim on 2016. 12. 29..
 */

public class Units {
    private String temperatureUnit = null;
    private String windSpeedUnit = null;
    private String pressureUnit = null;
    private String distanceUnit = null;
    private String precipitationUnit = null;

    public Units() {
        this.temperatureUnit = "C";
        this.windSpeedUnit = "m/s";
        this.pressureUnit = "hPa";
        this.distanceUnit = "m";
        this.precipitationUnit = "mm";
    }

    public Units(String jsonStr) {
        JSONObject unitObj = null;
        try {
            unitObj = new JSONObject(jsonStr);
            if (unitObj != null) {
                this.temperatureUnit = unitObj.getString("temperatureUnit");
                this.windSpeedUnit = unitObj.getString("windSpeedUnit");
                this.pressureUnit = unitObj.getString("pressureUnit");
                this.distanceUnit = unitObj.getString("distanceUnit");
                this.precipitationUnit = unitObj.getString("precipitationUnit");
                return;
            }
            Log.e("Units", "Fail to convert string to json");

        } catch (JSONException e) {
            e.printStackTrace();
        }

        this.temperatureUnit = "C";
        this.windSpeedUnit = "m/s";
        this.pressureUnit = "hPa";
        this.distanceUnit = "m";
        this.precipitationUnit = "mm";
    }

    public void setTemperatureUnit(String temperatureUnit) {
        this.temperatureUnit = temperatureUnit;
    }

    public void setWindSpeedUnit(String windSpeedUnit) {
        this.windSpeedUnit = windSpeedUnit;
    }

    public void setPressureUnit(String pressureUnit) {
        this.pressureUnit = pressureUnit;
    }

    public void setDistanceUnit(String distanceUnit) {
        this.distanceUnit = distanceUnit;
    }

    public void setPrecipitationUnit(String precipitationUnit) {
        this.precipitationUnit = precipitationUnit;
    }

    public String getTemperatureUnit() {
        return temperatureUnit;
    }

    public String getWindSpeedUnit() {
        return windSpeedUnit;
    }

    public String getPressureUnit() {
        return pressureUnit;
    }

    public String getDistanceUnit() {
        return distanceUnit;
    }

    public String getPrecipitationUnit() {
        return precipitationUnit;
    }

    private double _convertTemperature(String from, String to, double val) {
        if ( from.equals("C")) {
            if (to.equals("F")) {
                return val/(5.0/9)+32;
            }
        }
        else if (from.equals("F")) {
            if (to.equals("C")) {
                return (val - 32) / (9.0/5);
            }
        }
        Log.e("Units", "Fail to convert from "+from+" to "+to+" value="+val);
        return val;
    }

    private double _getBeaufort(double ms) {
        if (ms < 0.3) {
            return 0;
        }
        else if (ms < 1.5) {
            return 1;
        }
        else if (ms < 3.3) {
            return 2;
        }
        else if (ms < 5.5) {
            return 3;
        }
        else if (ms < 8.0) {
            return 4;
        }
        else if (ms < 10.8) {
            return 5;
        }
        else if (ms < 13.9) {
            return 6;
        }
        else if (ms < 17.2) {
            return 7;
        }
        else if (ms < 20.7) {
            return 8;
        }
        else if (ms < 24.5) {
            return 9;
        }
        else if (ms < 28.4) {
            return 10;
        }
        else if (ms < 32.6) {
            return 11;
        }
        else if (ms >= 32.6) {
            return 12;
        }

        return -1;
    }

    private double _convertBeaufortToMs(double val) {
        switch ((int) val) {
            case 0: return 0;
            case 1: return 0.3;
            case 2: return 1.5;
            case 3: return 3.3;
            case 4: return 5.5;
            case 5: return 8.0;
            case 6: return 10.8;
            case 7: return 13.9;
            case 8: return 17.2;
            case 9: return 20.7;
            case 10: return 24.5;
            case 11: return 28.4;
            case 12: return 32.6;
        }
        return 0;
    }

    private double _convertWindSpeed(String from, String toStr, double val) {
        if (from.equals("mph")) {
            if (toStr.equals("km/h")) {
                return val * 1.609344;

            } else if (toStr.equals("m/s")) {
                return val * 0.44704;

            } else if (toStr.equals("bft")) {
                return _getBeaufort(val * 0.44704);

            } else if (toStr.equals("kt")) {
                return val * 0.868976;

            }

        } else if (from.equals("km/h")) {
            if (toStr.equals("mph")) {
                return val * 0.621371;

            } else if (toStr.equals("m/s")) {
                return val * 0.277778;

            } else if (toStr.equals("bft")) {
                return _getBeaufort(val * 0.277778);

            } else if (toStr.equals("kt")) {
                return val * 0.539957;
            }

        } else if (from.equals("m/s")) {
            if (toStr.equals("mph")) {
                return val * 2.236936;

            } else if (toStr.equals("km/h")) {
                return val * 3.6;

            } else if (toStr.equals("bft")) {
                return _getBeaufort(val);

            } else if (toStr.equals("kt")) {
                return val * 1.943844;

            }

        } else if (from.equals("bft")) {
            double ms = _convertBeaufortToMs(val);
            if (toStr.equals("mph")) {
                return ms * 2.236936;

            } else if (toStr.equals("km/h")) {
                return ms * 3.6;

            } else if (toStr.equals("m/s")) {
                return ms;

            } else if (toStr.equals("kt")) {
                return ms * 1.943844;

            }

        } else if (from.equals("kt")) {
            if (toStr.equals("mph")) {
                return val * 1.150779;

            } else if (toStr.equals("km/h")) {
                return val * 1.852;

            } else if (toStr.equals("m/s")) {
                return val * 0.514444;

            } else if (toStr.equals("bft")) {
                return _getBeaufort(val * 0.514444);

            }

        }

        return val;
    }

    private double _convertPressure(String from, String to, double val) {
        if (from.equals("mmHg")) {
            if (to.equals("inHg")) {
                return val * 0.03937;

            } else if (to.equals("hPa") || to.equals("mb")) {
                return val * 1.333224;

            }

        } else if (from.equals("inHg")) {
            if (to.equals("mmHg")) {
                return val * 25.4;

            } else if (to.equals("hPa") || to.equals("mb")) {
                return val * 33.863882;

            }

        } else if (from.equals("hPa") || from.equals("mb")) {
            if (to.equals("mmHg")) {
                return val * 0.750062;

            } else if (to.equals("inHg")) {
                return val * 0.02953;

            } else if (to.equals("hPa") || to.equals("mb")) {
                return val;

            }
        }
        return val;
    }

    private double _convertDistance(String from, String to, double val) {
        if (from.equals("m")) {
            return val*39.370079;
        }
        else if (from.equals("mi")) {
            return val*0.0254;
        }
        return val;
    }

    private double _convertPrecipitation(String from, String to, double val) {
        if (from.equals("mm")) {
            return val*0.03937;
        }
        else if (from.equals("in")) {
            return val*25.4;
        }
        return val;
    }

    public String convertUnitsStr(String from, double val) {
        double retVal = convertUnits(from, val);
        String str = null;

        if (from.equals("C") || from.equals("F")) {
            if (this.temperatureUnit.equals("F")) {
                str = String.valueOf(Math.round(retVal));
            }
            else {
                str = String.format("%.1f", retVal);
            }
        }
        else if (from.equals("mph") || from.equals("km/h") || from.equals("m/s") || from.equals("bft") || from.equals("kt")) {
            str = String.format("%.1f", retVal);
        }
        else if (from.equals("mmHg") || from.equals("inHg") || from.equals("hPa") || from.equals("mb")) {
            str = String.format("%.1f", retVal);
        }
        else if (from.equals("m") || from.equals("mi")) {
            str = String.valueOf(Math.round(retVal));
        }
        else if (from.equals("mm") || from.equals("in")) {
            str = String.format("%.1f", retVal);
        }
        else {
            str = String.valueOf(Math.round(retVal));
        }

        return str;
    }

    public double convertUnits(String from, double val) {
        String to = null;

        if (from.equals("C") || from.equals("F")) {
            to = this.temperatureUnit;
        }
        else if (from.equals("mph") || from.equals("km/h") || from.equals("m/s") || from.equals("bft") || from.equals("kt")) {
            to = this.windSpeedUnit;
        }
        else if (from.equals("mmHg") || from.equals("inHg") || from.equals("hPa") || from.equals("mb")) {
            to = this.pressureUnit;
        }
        else if (from.equals("m") || from.equals("mi")) {
            to = this.distanceUnit;
        }
        else if (from.equals("mm") || from.equals("in")) {
            to = this.precipitationUnit;
        }

        return convertUnits(from, to, val);
    }

    public double convertUnits(String from, String to, double val) {
        if (from == null || to == null) {
            Log.e("Units", "from or to is null");
            return val;
        }
        if (from.equals(to)) {
            return val;
        }

        if (from.equals("C") || from.equals("F")) {
            return _convertTemperature(from, to, val);
        }
        else if (from.equals("mph") || from.equals("km/h") || from.equals("m/s") || from.equals("bft") || from.equals("kt")) {
            return _convertWindSpeed(from, to, val);
        }
        else if (from.equals("mmHg") || from.equals("inHg") || from.equals("hPa") || from.equals("mb")) {
            return _convertPressure(from, to, val);
        }
        else if (from.equals("m") || from.equals("mi")) {
            return _convertDistance(from, to, val);
        }
        else if (from.equals("mm") || from.equals("in")) {
            return _convertPrecipitation(from, to, val);
        }

        Log.e("Units", "Fail to convert from "+from+" to "+to+" value="+val);
        return val;
    }
}
