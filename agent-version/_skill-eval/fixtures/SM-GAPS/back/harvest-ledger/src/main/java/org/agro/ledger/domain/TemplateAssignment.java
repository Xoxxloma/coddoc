package org.agro.ledger.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "template_assignment", schema = "ledger")
public class TemplateAssignment {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(optional = false)
  @JoinColumn(name = "template_id")
  private MeasurementTemplate template;

  @Column(name = "agronomist_number", nullable = false, unique = true)
  private String agronomistNumber;
}
