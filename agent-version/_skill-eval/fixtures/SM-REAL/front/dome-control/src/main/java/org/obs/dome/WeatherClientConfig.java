package org.obs.dome;

import feign.Feign;
import org.obs.weather.client.ForecastApi;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class WeatherClientConfig {
    /** Клиент к weather-feed — сгенерирован из src/main/resources/openapi/weather-feed.yaml. */
    @Bean
    public ForecastApi forecastApi(@Value("${clients.weather-feed.url}") String url) {
        return Feign.builder().target(ForecastApi.class, url);
    }
}
