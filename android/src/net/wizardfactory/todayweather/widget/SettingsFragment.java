package net.wizardfactory.todayweather.widget;


import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.preference.ListPreference;
import android.preference.Preference;
import android.preference.PreferenceFragment;
import android.preference.PreferenceManager;
import android.util.Log;

import net.wizardfactory.todayweather.R;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * A simple {@link PreferenceFragment} subclass.
 */
public class SettingsFragment extends PreferenceFragment {
    private static final String TAG = "SettingsFragment";

    private SharedPreferences mSharedPreferences;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Load the preferences from an XML resource
        addPreferencesFromResource(R.xml.apppreferences);

        ListPreference location = (ListPreference)findPreference("location");
        JSONArray cityListArray = SettingsActivity.loadCityListPref(getActivity());
        if (cityListArray != null) {
            CharSequence[] locations = new CharSequence[cityListArray.length()];
            CharSequence[] locationValues = new CharSequence[cityListArray.length()];
            for (int i = 0; i < cityListArray.length(); i++) {
                try {
                    JSONObject object = cityListArray.getJSONObject(i);
                    boolean currentPosition = object.getBoolean("currentPosition");
                    if (currentPosition) {
                        locations[i] = getActivity().getString(R.string.current_position);
                    } else {
                        if (object.has("name")) {
                            locations[i] = object.get("name").toString();
                        } else {
                            locations[i] = object.get("address").toString();
                        }
                    }
                    locationValues[i] = object.toString();
                } catch (JSONException e) {
                    Log.e(TAG, "JSONException: " + e.getMessage());
                    continue;
                }
            }
            if (locations.length > 0) {
                location.setEntries(locations);
                location.setEntryValues(locationValues);
                location.setValueIndex(0);
                location.setSummary(location.getEntry());

                location.setOnPreferenceChangeListener(new Preference.OnPreferenceChangeListener() {
                    @Override
                    public boolean onPreferenceChange(Preference preference, Object newValue) {
                        ListPreference location = (ListPreference) preference;
                        int index = location.findIndexOfValue((String)newValue);
                        CharSequence[] entries = location.getEntries();
                        location.setSummary(entries[index]);
                        return true;
                    }
                });
            } else {
                onShowAlertDialog();
            }
        } else {
            onShowAlertDialog();
        }

        ListPreference refreshInterval = (ListPreference)findPreference("refreshInterval");
        refreshInterval.setValueIndex(0);
        refreshInterval.setSummary(refreshInterval.getEntry());

        refreshInterval.setOnPreferenceChangeListener(new Preference.OnPreferenceChangeListener() {
            @Override
            public boolean onPreferenceChange(Preference preference, Object newValue) {
                ListPreference refreshInterval = (ListPreference) preference;
                int index = refreshInterval.findIndexOfValue((String) newValue);
                CharSequence[] entries = refreshInterval.getEntries();
                refreshInterval.setSummary(entries[index]);
                return true;
            }
        });

        ListPreference transparency = (ListPreference)findPreference("transparency");
        transparency.setValueIndex(0);
        transparency.setSummary(transparency.getEntry());

        transparency.setOnPreferenceChangeListener(new Preference.OnPreferenceChangeListener() {
            @Override
            public boolean onPreferenceChange(Preference preference, Object newValue) {
                ListPreference transparency = (ListPreference) preference;
                int index = transparency.findIndexOfValue((String) newValue);
                if (index == 0) {
                    CharSequence[] entries = transparency.getEntries();
                    transparency.setSummary(entries[index]);
                } else {
                    transparency.setSummary("%s");
                }
                return true;
            }
        });

        com.kizitonwose.colorpreference.ColorPreference backgroundColor = (com.kizitonwose.colorpreference.ColorPreference)findPreference("backgroundColor");
        backgroundColor.setValue(Color.BLACK);
        backgroundColor.setSummary(String.format("#%06X", (0xFFFFFF & Color.BLACK)));

        backgroundColor.setOnPreferenceChangeListener(new Preference.OnPreferenceChangeListener() {
            @Override
            public boolean onPreferenceChange(Preference preference, Object newValue) {
                com.kizitonwose.colorpreference.ColorPreference backgroundColor = (com.kizitonwose.colorpreference.ColorPreference) preference;
                int color = (Integer) newValue;
                backgroundColor.setSummary(String.format("#%06X", (0xFFFFFF & color)));
                return true;
            }
        });

        com.kizitonwose.colorpreference.ColorPreference fontColor = (com.kizitonwose.colorpreference.ColorPreference)findPreference("fontColor");
        fontColor.setValue(Color.WHITE);
        fontColor.setSummary(String.format("#%06X", (0xFFFFFF & Color.WHITE)));

        fontColor.setOnPreferenceChangeListener(new Preference.OnPreferenceChangeListener() {
            @Override
            public boolean onPreferenceChange(Preference preference, Object newValue) {
                com.kizitonwose.colorpreference.ColorPreference fontColor = (com.kizitonwose.colorpreference.ColorPreference) preference;
                int color = (Integer) newValue;
                fontColor.setSummary(String.format("#%06X", (0xFFFFFF & color)));
                return true;
            }
        });
    }

    @Override
    public void onStart() {
        super.onStart();
        mSharedPreferences = PreferenceManager.getDefaultSharedPreferences(getActivity());
    }

    private void onShowAlertDialog() {
        AlertDialog.Builder alert = new AlertDialog.Builder(getActivity());
        alert.setPositiveButton(R.string.ok, new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialog, int which) {
                dialog.dismiss();
                getActivity().finish();
            }
        });
        alert.setMessage(R.string.add_locations);
        alert.show();
    }
}
