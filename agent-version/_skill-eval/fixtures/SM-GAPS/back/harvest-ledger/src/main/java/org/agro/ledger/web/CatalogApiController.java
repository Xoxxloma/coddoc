package org.agro.ledger.web;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.CatalogApi;
import org.agro.ledger.api.model.Crop;
import org.agro.ledger.api.model.CropUsage;
import org.agro.ledger.service.CatalogService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class CatalogApiController implements CatalogApi {

  private final CatalogService service;

  @Override
  public ResponseEntity<List<Crop>> listCrops() {
    return ResponseEntity.ok(service.all().stream().map(c -> {
      Crop dto = new Crop();
      dto.setId(c.getId());
      dto.setCode(c.getCode());
      dto.setName(c.getName());
      dto.setGroupId(c.getGroup() == null ? null : c.getGroup().getId());
      return dto;
    }).toList());
  }

  @Override
  @PreAuthorize("hasRole('METHODIST')")
  public ResponseEntity<Void> createCrop(Crop body) {
    service.create(body.getCode(), body.getName(), body.getGroupId());
    return ResponseEntity.status(HttpStatus.CREATED).build();
  }

  @Override
  @PreAuthorize("hasRole('METHODIST')")
  public ResponseEntity<Void> renameCrop(Long id, Crop body) {
    service.rename(id, body.getName(), body.getGroupId());
    return ResponseEntity.noContent().build();
  }

  @Override
  @PreAuthorize("hasRole('METHODIST')")
  public ResponseEntity<Void> deleteCrop(Long id) {
    service.delete(id);
    return ResponseEntity.noContent().build();
  }

  @Override
  @PreAuthorize("hasRole('METHODIST')")
  public ResponseEntity<CropUsage> getCropUsage(Long id) {
    return ResponseEntity.ok(service.usage(id));
  }
}
