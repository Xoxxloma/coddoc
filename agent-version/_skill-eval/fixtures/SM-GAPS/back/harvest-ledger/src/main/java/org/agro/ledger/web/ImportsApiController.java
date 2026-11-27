package org.agro.ledger.web;

import java.time.ZoneOffset;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.ImportsApi;
import org.agro.ledger.api.model.ImportInfo;
import org.agro.ledger.domain.WeatherImport;
import org.agro.ledger.security.CurrentUser;
import org.agro.ledger.service.WeatherImportService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequiredArgsConstructor
public class ImportsApiController implements ImportsApi {

  private final WeatherImportService service;

  @Override
  public ResponseEntity<Void> uploadWeather(MultipartFile file) {
    service.load(CurrentUser.number(), file);
    return ResponseEntity.status(HttpStatus.ACCEPTED).build();
  }

  @Override
  public ResponseEntity<ImportInfo> getLastImport() {
    WeatherImport w = service.last();
    ImportInfo d = new ImportInfo();
    d.setFileName(w.getFileName());
    d.setRows(w.getRowsLoaded());
    d.setLoadedAt(w.getLoadedAt().atOffset(ZoneOffset.UTC));
    return ResponseEntity.ok(d);
  }
}
