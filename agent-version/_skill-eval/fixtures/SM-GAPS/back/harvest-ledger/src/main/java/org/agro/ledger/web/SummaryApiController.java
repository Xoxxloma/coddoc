package org.agro.ledger.web;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.SummaryApi;
import org.agro.ledger.api.model.CropTotal;
import org.agro.ledger.api.model.SummaryRow;
import org.agro.ledger.api.model.Unit;
import org.agro.ledger.directory.RegionDirectoryDao;
import org.agro.ledger.service.SummaryService;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequiredArgsConstructor
public class SummaryApiController implements SummaryApi {

  private final SummaryService service;

  @Override
  @PreAuthorize("hasAnyRole('HEAD_AGRONOMIST', 'METHODIST')")
  public ResponseEntity<List<SummaryRow>> getSummary(String level, String month, List<Long> ids) {
    return ResponseEntity.ok(service.summary(level, ids, month));
  }

  @Override
  @PreAuthorize("hasAnyRole('HEAD_AGRONOMIST', 'METHODIST')")
  public ResponseEntity<Resource> exportSummaryXlsx(String level, String month) {
    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=summary-" + month + ".xlsx")
        .body(new ByteArrayResource(service.exportXlsx(level, month)));
  }

  @Override
  @PreAuthorize("hasAnyRole('HEAD_AGRONOMIST', 'METHODIST')")
  public ResponseEntity<List<CropTotal>> getSummaryByCrop(String month) {
    return ResponseEntity.ok(service.byCrop(month));
  }

  @Override
  public ResponseEntity<List<Unit>> listRegions() {
    return ResponseEntity.ok(service.regions().stream().map(SummaryApiController::unit).toList());
  }

  @Override
  public ResponseEntity<List<Unit>> listFarms(Long regionId) {
    return ResponseEntity.ok(service.farms(regionId).stream().map(SummaryApiController::unit).toList());
  }

  @Override
  @PreAuthorize("hasAnyRole('HEAD_AGRONOMIST', 'METHODIST')")
  public ResponseEntity<Resource> exportSummaryPdf(String month) {
    // TODO: вёрстка PDF не готова
    throw new ResponseStatusException(HttpStatus.NOT_IMPLEMENTED, "PDF export is not available yet");
  }

  static Unit unit(RegionDirectoryDao.Unit u) {
    Unit d = new Unit();
    d.setId(u.id());
    d.setName(u.name());
    return d;
  }
}
