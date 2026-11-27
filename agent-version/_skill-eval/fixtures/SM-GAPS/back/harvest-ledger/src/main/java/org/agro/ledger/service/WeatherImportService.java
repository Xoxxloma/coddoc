package org.agro.ledger.service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.domain.WeatherImport;
import org.agro.ledger.domain.WeatherReading;
import org.agro.ledger.repository.WeatherImportRepository;
import org.agro.ledger.repository.WeatherReadingRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class WeatherImportService {

  private final WeatherImportRepository imports;
  private final WeatherReadingRepository readings;

  /**
   * CSV «хозяйство;дата;осадки мм;температура». Показание за тот же день по тому же хозяйству
   * перезаписывается. Ошибка в строке — загрузка помечается FAILED, строки до ошибки остаются.
   */
  @Transactional(noRollbackFor = ResponseStatusException.class)
  public WeatherImport load(String loadedBy, MultipartFile file) {
    WeatherImport imp = new WeatherImport();
    imp.setFileName(file.getOriginalFilename());
    imp.setLoadedBy(loadedBy);
    imp.setStatus("OK");
    imports.save(imp);
    int n = 0;
    try (BufferedReader in = new BufferedReader(new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8))) {
      String line;
      while ((line = in.readLine()) != null) {
        if (line.isBlank() || line.startsWith("#")) continue;
        String[] c = line.split(";");
        long farm = Long.parseLong(c[0].trim());
        LocalDate date = LocalDate.parse(c[1].trim());
        WeatherReading r = readings.findByFarmIdAndReadingDate(farm, date).orElseGet(WeatherReading::new);
        r.setWeatherImport(imp);
        r.setFarmId(farm);
        r.setReadingDate(date);
        r.setPrecipitationMm(new BigDecimal(c[2].trim()));
        r.setTemperatureC(c.length > 3 ? new BigDecimal(c[3].trim()) : null);
        readings.save(r);
        n++;
      }
    } catch (Exception e) {
      imp.setStatus("FAILED");
      imp.setError(e.getMessage());
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "bad file at row " + (n + 1));
    }
    imp.setRowsLoaded(n);
    return imp;
  }

  public WeatherImport last() {
    return imports.findFirstByStatusOrderByLoadedAtDesc("OK")
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "no imports yet"));
  }
}
