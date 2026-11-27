package org.agro.ledger.repository;

import java.util.Collection;
import java.util.List;
import org.agro.ledger.domain.TemplateAssignment;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TemplateAssignmentRepository extends JpaRepository<TemplateAssignment, Long> {
  boolean existsByAgronomistNumberIn(Collection<String> numbers);

  List<TemplateAssignment> findByAgronomistNumberIn(Collection<String> numbers);

  List<TemplateAssignment> findByTemplateId(Long templateId);

  void deleteByTemplateIdAndAgronomistNumber(Long templateId, String agronomistNumber);
}
