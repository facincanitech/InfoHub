package com.facincanitech.infohub;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashSet;
import java.util.Set;

// Ponte JS <-> agendamento nativo de alarme. O JS continua decidindo os
// horários (state.alarmTimes) e o conteúdo do briefing (buildQueue) — esse
// plugin só cuida de acordar o sistema e abrir o app no horário certo.
@CapacitorPlugin(name = "BriefingAlarm")
public class BriefingAlarmPlugin extends Plugin {
    public static final String EXTRA_AUTOPLAY_TIME = "infohub_autoplay_time";

    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray timesArray = call.getArray("times");
        Set<String> times = new HashSet<>();
        try {
            for (int i = 0; i < timesArray.length(); i++) {
                times.add(timesArray.getString(i));
            }
        } catch (Exception e) {
            call.reject("Erro ao ler horários: " + e.getMessage());
            return;
        }
        BriefingAlarmScheduler.scheduleAll(getContext(), times);
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        BriefingAlarmScheduler.cancelAllSaved(getContext());
        call.resolve();
    }

    // Chamado pelo JS assim que o app carrega, pra saber se foi aberto por
    // causa do alarme (app estava fechado, full-screen intent abriu ele).
    @PluginMethod
    public void consumePendingAlarm(PluginCall call) {
        String time = getActivity().getIntent().getStringExtra(EXTRA_AUTOPLAY_TIME);
        if (time != null) {
            getActivity().getIntent().removeExtra(EXTRA_AUTOPLAY_TIME);
        }
        JSObject ret = new JSObject();
        ret.put("time", time);
        call.resolve(ret);
    }

    // Chamado pela MainActivity quando o alarme dispara com o app já aberto
    // (onNewIntent) — nesse caso não dá pra "consumir" de novo, manda direto.
    public void emitAlarmFired(String time) {
        JSObject data = new JSObject();
        data.put("time", time);
        notifyListeners("alarmFired", data);
    }
}
