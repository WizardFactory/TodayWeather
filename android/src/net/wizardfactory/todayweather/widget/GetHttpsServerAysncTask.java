package net.wizardfactory.todayweather.widget;

import android.os.AsyncTask;
import android.util.Log;

import java.io.BufferedReader;
import java.io.DataInputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

import javax.net.ssl.HttpsURLConnection;

/**
 *  This class http server connect form "GET" Type
 *  Now used for get weather data and location address for geocoder.
 */
public class GetHttpsServerAysncTask extends AsyncTask<String, String, String> {
    private String url = null;

    public GetHttpsServerAysncTask(String url){
        this.url = url;
    }

    @Override
    protected void onPreExecute() {
        // do nothing
    }

    @Override
    protected String doInBackground(String... arg0) {
        Log.i("AsyncTask" , "url: " + url);
        return GetWeatherFromHttpsServer(url);
    }

    @Override
    protected void onPostExecute(String jsonStr) {
        // do nothing
    }

    private String GetWeatherFromHttpsServer(String strUrl) {
        String retString = "";
        DataInputStream dis = null;
        StringBuilder messageBuilder = new StringBuilder();
        HttpURLConnection urlConnection = null;
        try {
            URL url = new URL(strUrl);
            urlConnection = (HttpURLConnection) url.openConnection();
            urlConnection.setDoOutput(false);
            urlConnection.setRequestMethod("GET");

            BufferedReader bi2 = new BufferedReader( new InputStreamReader( urlConnection.getInputStream() ) );
            String s = "";
            while ((s = bi2.readLine()) != null) {
                retString += s;
            }
        } catch (Exception e) {
            Log.e("AsynTask", e.toString());
            e.printStackTrace();
        } finally {
            urlConnection.disconnect();
        }

        Log.e("AsyncTask", "ret: " + retString);
        return retString;
    }
}
