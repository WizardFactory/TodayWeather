package net.wizardfactory.todayweather.widget.JsonElement;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;

/**
 * this class parsing json string that result of google geocoder.
 */
public class AddressesElement {
    private String[] addrs = null;

    public String[] getAddrs() {
        return addrs;
    }

    public void setAddrs(String[] addrs) {
        this.addrs = addrs;
    }

    // jsonStr is result from google geocoder.
    // "formatted_address" is only used in json data.
    public static AddressesElement parsingAddressJson2String(String jsonStr) {
        AddressesElement retElement = null;

        try {
            JSONObject result = new JSONObject(jsonStr);
            if (result != null) {
                String status = result.getString("status");
                if (!status.equals("OK")) {
                    Log.e("AddressesElement", "status="+status);
                    return retElement;
                }

                retElement = new AddressesElement();

                JSONArray arrReader = result.getJSONArray("results");
                int len = arrReader.length();

                if (arrReader != null && len > 0) {
                    String[] addrs = new String[len];

                    for (int i =0; i< len; i++ ) {
                        JSONObject reader = arrReader.getJSONObject(i);

                        if (reader != null) {
                            addrs[i] = reader.getString("formatted_address");
                        } else {
                            Log.e("AddressesElement", "addrs[" + i + "] json string is NULL");
                        }
                    }

                    retElement.setAddrs(addrs);
                }
                else {
                    Log.e("AddressesElement", "arrReader array json string is NULL");
                }
            }
            else {
                Log.e("AddressesElement", "Short result string is NULL");
            }
        } catch (JSONException e) {
            e.printStackTrace();
        } catch (Exception e){
            e.printStackTrace();
        }
        return retElement;
    }

    /**
     * It's supporting only korean lang
     * @param {Object[]} results
     * @returns {string}
     */
     public String findDongAddressFromGoogleGeoCodeResults() {
         String dongAddress = null;
         int length = 0;

         for (int i =0; i< addrs.length; i++) {
             String lastStr = addrs[i].substring(addrs[i].length()-1);
             try {
                 // hangle encoding type is same as geocoder result.
                 byte[] dongBytes = {-21, -113, -103};  // ��
                 String dong = new String(dongBytes, "utf-8");

                 byte[] yupBytes = {-20, -99, -115};    // ��
                 String yup = new String(yupBytes, "utf-8");

                 byte[] myenBytes = {-21, -87, -76};    // ��
                 String myen = new String(myenBytes, "utf-8");

                 if (lastStr.equals(dong) || lastStr.equals(yup) || lastStr.equals(myen)) {
                     if (length <  addrs[i].length()) {
                         dongAddress =  addrs[i];
                         length =  addrs[i].length();
                     }
                 }
             } catch (UnsupportedEncodingException e) {
                 e.printStackTrace();
             }
         }
         return dongAddress;
    }

    // this is same as app code that write javascript
    public static String makeUrlAddress(String addr) {
        String retUrl = null;

        if (addr != null) {
            String[] addrTokens = addr.split(" ");

            if (addrTokens.length == 5) {
                //nation + do + si + gu + dong
                retUrl = "/" + encodingUtf8(addrTokens[1]) + "/" + encodingUtf8(addrTokens[2]) + encodingUtf8(addrTokens[3]) + "/" + encodingUtf8(addrTokens[4]);
            } else if (addrTokens.length == 4) {
                retUrl = "/" + encodingUtf8(addrTokens[1]);
                if (addrTokens[3].substring(addrTokens[3].length()-1).equals("구")) {
                    //nation + do + si + gu
                    retUrl +=  "/" + encodingUtf8(addrTokens[2]) + encodingUtf8(addrTokens[3]);
                }
                else {
                    //nation + si + gu + dong
                    retUrl += "/" + encodingUtf8(addrTokens[2]) + "/" + encodingUtf8(addrTokens[3]);
                }
            } else if (addrTokens.length == 3) {
                String lastChar = addrTokens[2].substring(addrTokens[2].length()-1);
                if (lastChar.equals("읍") || lastChar.equals("면") || lastChar.equals("동")) {
                    //nation + si + myeon,eup,dong
                    retUrl = "/" + encodingUtf8(addrTokens[1]) + "/" + encodingUtf8(addrTokens[1]) + "/" + encodingUtf8(addrTokens[2]);
                }
                else {
                    //nation + si,do + si, gun, gu
                    retUrl = "/" + encodingUtf8(addrTokens[1]) + "/" + encodingUtf8(addrTokens[2]);
                }
            } else if (addrTokens.length == 2) {
                //nation + si,do
                retUrl = "/" + encodingUtf8(addrTokens[1]);
            } else {
                Log.e("AddressElement", "address is invalid");
            }
        }

        return retUrl;
    }

    // if url address is changed utf-8, server read right  address.
    private static String encodingUtf8(String str) {
        String retStr = null;
        try {
            retStr = URLEncoder.encode(str, "utf-8");
        } catch (UnsupportedEncodingException e) {
            e.printStackTrace();
        }
        return retStr;
    }
}
