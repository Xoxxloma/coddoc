package org.obs.dome;

import java.time.Instant;
import java.time.LocalDate;
import org.obs.weather.client.ForecastApi;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.CONFLICT;
import static org.springframework.http.HttpStatus.NOT_FOUND;

@Service
public class DomeService {
    private final DomeRepository domes;
    private final ForecastApi forecastApi;
    private final double maxCloudCover;

    public DomeService(DomeRepository domes, ForecastApi forecastApi, @Value("${dome.max-cloud-cover}") double maxCloudCover) {
        this.domes = domes;
        this.forecastApi = forecastApi;
        this.maxCloudCover = maxCloudCover;
    }

    public Dome get(String id) {
        return domes.findById(id).orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "купол не найден"));
    }

    /** Открыть купол нельзя на обслуживании и при облачности выше порога (прогноз — у weather-feed). */
    public Dome open(String id, String operator) {
        Dome dome = get(id);
        if (dome.getState() == Dome.DomeState.MAINTENANCE) throw new ResponseStatusException(CONFLICT, "купол на обслуживании");
        var forecast = forecastApi.getForecast(LocalDate.now());
        if (forecast.getCloudCover() > maxCloudCover) throw new ResponseStatusException(CONFLICT, "облачность выше порога");
        if (!forecastApi.getCloudAlerts().isEmpty()) throw new ResponseStatusException(CONFLICT, "действует предупреждение");
        return change(dome, Dome.DomeState.OPEN, operator);
    }

    /** Закрыть можно всегда; повторное закрытие — без ошибки. */
    public Dome close(String id, String operator) {
        Dome dome = get(id);
        if (dome.getState() == Dome.DomeState.CLOSED) return dome;
        return change(dome, Dome.DomeState.CLOSED, operator);
    }

    private Dome change(Dome dome, Dome.DomeState to, String operator) {
        dome.setState(to);
        dome.setChangedBy(operator);
        dome.setChangedAt(Instant.now());
        return domes.save(dome);
    }
}
