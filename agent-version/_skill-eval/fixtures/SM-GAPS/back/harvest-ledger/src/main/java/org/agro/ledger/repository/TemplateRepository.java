package org.agro.ledger.repository;

import java.util.List;
import org.agro.ledger.domain.MeasurementTemplate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface TemplateRepository extends JpaRepository<MeasurementTemplate, Long> {
  List<MeasurementTemplate> findByOwnerNumber(String ownerNumber);

  @Query("select count(t) from MeasurementTemplate t join t.crops c where c.id = :cropId")
  long countUsingCrop(Long cropId);
}
